#!/usr/bin/env node
// Integration suite for the DEPLOYED Ghana Payments dev environment.
// Plain Node (no jest) — drives the live stack via its public CloudFront URL as a
// pure API client. Never touches infrastructure; cleans up what it creates.
//
// Usage:   npm run test:integration          (from packages/ghana-payments)
//          STAGE=dev node test/integration/run.mjs
//
// Skips (exit 0 with a warning) when AWS credentials or the dev stacks are absent,
// so CI lint/test jobs stay green without a deployed environment.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from '@aws-sdk/client-cognito-identity';
import mqtt from 'mqtt';

const exec = promisify(execFile);
const STAGE = process.env.STAGE ?? 'dev';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

// ---------------------------------------------------------------------------
// tiny harness
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}`);
  }
}
function fatal(name) {
  failures.push(name);
  console.error(`  ✗ FATAL: ${name}`);
  throw new Error(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function skip(reason) {
  console.warn(`\n[SKIP] ${reason}`);
  console.warn('[SKIP] Integration tests need AWS credentials and the deployed dev stacks.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// environment resolution — CloudFormation outputs, never hardcoded URLs
// ---------------------------------------------------------------------------
async function awsCli(args) {
  const { stdout } = await exec('aws', [...args, '--region', REGION, '--output', 'json']);
  return JSON.parse(stdout);
}

async function stackOutputs(stackName) {
  const res = await awsCli(['cloudformation', 'describe-stacks', '--stack-name', stackName]);
  return Object.fromEntries((res.Stacks[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
}

async function resolveEnvironment() {
  try {
    await exec('aws', ['sts', 'get-caller-identity', '--region', REGION]);
  } catch (err) {
    await skip(
      err.code === 'ENOENT'
        ? 'aws CLI not found on PATH'
        : `no usable AWS credentials (${err.stderr?.trim().split('\n')[0] ?? err.message})`
    );
  }
  let web, api, foundation;
  try {
    [web, api, foundation] = await Promise.all([
      stackOutputs(`${STAGE}-ghana-payments-web`),
      stackOutputs(`${STAGE}-ghana-payments-api`),
      stackOutputs(`${STAGE}-ghana-payments-foundation`),
    ]);
  } catch (err) {
    await skip(`ghana-payments ${STAGE} stacks not deployed (${err.stderr?.trim().split('\n')[0] ?? err.message})`);
  }
  const portalUrl = web.PortalUrl?.replace(/\/$/, '');
  const keyId = api.AdminApiKeyId;
  const inboxBucket = foundation.WebhookInboxBucket;
  if (!portalUrl || !keyId || !inboxBucket) await skip('expected stack outputs missing');
  const key = await awsCli(['apigateway', 'get-api-key', '--api-key', keyId, '--include-value']);
  return { portalUrl, adminKey: key.value, inboxBucket };
}

// ---------------------------------------------------------------------------
// API client (through CloudFront /api/* — same path the portals use)
// ---------------------------------------------------------------------------
let ENV;
async function api(method, path, { body, admin = false, raw } = {}) {
  const res = await fetch(`${ENV.portalUrl}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(admin ? { 'x-api-key': ENV.adminKey } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json };
}

async function pollPayment(paymentId, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await api('GET', `/v1/payments/${paymentId}`);
    last = res.body;
    if (last && ['SUCCESS', 'FAILED', 'EXPIRED'].includes(last.status)) return last;
    await sleep(2000);
  }
  return last;
}

async function balance(phone) {
  const res = await api('GET', `/v1/wallets/${encodeURIComponent(phone)}`);
  return res.body?.balance_pesewas;
}

async function pollBalance(phone, expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let b;
  while (Date.now() < deadline) {
    b = await balance(phone);
    if (b === expected) return b;
    await sleep(2000);
  }
  return b;
}

// ---------------------------------------------------------------------------
// SigV4-presigned MQTT-over-WSS URL (same approach as spike/node-client.mjs and
// device-client — service iotdevicegateway, host-only signed headers)
// ---------------------------------------------------------------------------
const sha256 = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
function signedIotUrl({ endpoint, region, accessKeyId, secretAccessKey, sessionToken }) {
  const amzdate = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const date = amzdate.slice(0, 8);
  const service = 'iotdevicegateway';
  const scope = `${date}/${region}/${service}/aws4_request`;
  const query =
    'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    `&X-Amz-Credential=${encodeURIComponent(`${accessKeyId}/${scope}`)}` +
    `&X-Amz-Date=${amzdate}` +
    '&X-Amz-SignedHeaders=host';
  const canonical = ['GET', '/mqtt', query, `host:${endpoint}`, '', 'host', sha256('')].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzdate, scope, sha256(canonical)].join('\n');
  let key = hmac(`AWS4${secretAccessKey}`, date);
  for (const part of [region, service, 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  let url = `wss://${endpoint}/mqtt?${query}&X-Amz-Signature=${signature}`;
  if (sessionToken) url += `&X-Amz-Security-Token=${encodeURIComponent(sessionToken)}`;
  return url;
}

function connectMqtt(url, clientId, attempts = 4) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      const client = mqtt.connect(url, {
        clientId,
        protocolVersion: 4,
        clean: true,
        connectTimeout: 10_000,
        reconnectPeriod: 0,
      });
      let settled = false;
      const fail = (err) => {
        if (settled) return; // deliberate end() after success must not spawn a retry
        settled = true;
        client.end(true);
        if (n < attempts) {
          console.log(`    (mqtt connect attempt ${n} failed — policy propagation? retrying)`);
          setTimeout(() => tryOnce(n + 1), 3000);
        } else reject(err instanceof Error ? err : new Error(String(err)));
      };
      client.once('connect', () => {
        settled = true;
        resolve(client);
      });
      client.once('error', fail);
      client.once('close', () => fail(new Error('connection closed before CONNACK')));
    };
    tryOnce(1);
  });
}

// ---------------------------------------------------------------------------
// the suite
// ---------------------------------------------------------------------------
const run = randomUUID().slice(0, 8);
const state = {}; // created artifacts, for cleanup

async function main() {
  ENV = await resolveEnvironment();
  console.log(`\nGhana Payments integration suite — ${STAGE} @ ${ENV.portalUrl}\n`);

  // -- merchant + wallet ------------------------------------------------------
  console.log('merchant + wallet');
  const merch = await api('POST', '/v1/merchants', {
    admin: true,
    body: { display_name: `Integration Test ${run}`, phone: `02400${run.slice(0, 5)}`, business_category: 'test' },
  });
  if (merch.status !== 201) fatal(`create merchant -> ${merch.status} ${JSON.stringify(merch.body)}`);
  state.merchantId = merch.body.merchant_id;
  check(true, `merchant created (${state.merchantId})`);

  // Digit-only local format, like the pay portal. NOTE deliberate limitation: a
  // '+'-prefixed phone breaks the wallet flow today (see the URL-decoding finding
  // in the test report) — do not "fix" the test by encoding a plus here.
  const phone = `024${Date.now().toString().slice(-7)}`;
  const topup = await api('POST', `/v1/wallets/${encodeURIComponent(phone)}/topup`, {
    body: { amount_pesewas: 20_000 },
  });
  check(topup.status === 200 && topup.body.balance_pesewas === 20_000, 'wallet top-up of 20000 pesewas');
  let expected = 20_000;

  const pay = (amount) =>
    api('POST', '/v1/payments', {
      body: { merchant_id: state.merchantId, amount_pesewas: amount, payer_phone: phone },
    });

  // -- SUCCESS (any amount) ---------------------------------------------------
  console.log('payment outcomes (magic amounts, ADR-7)');
  const ok1 = await pay(2000);
  check(ok1.status === 201 && ok1.body.status === 'INITIATED', 'success payment initiated (2000)');
  state.successPaymentId = ok1.body.payment_id;
  const done1 = await pollPayment(ok1.body.payment_id);
  check(done1?.status === 'SUCCESS', `success payment reaches SUCCESS (got ${done1?.status})`);
  expected -= 2000;
  check((await pollBalance(phone, expected)) === expected, `wallet debited to ${expected} and NOT refunded`);

  // -- FAILED (1300) ----------------------------------------------------------
  const ok2 = await pay(1300);
  check(ok2.status === 201, 'fail payment initiated (1300)');
  const done2 = await pollPayment(ok2.body.payment_id);
  check(done2?.status === 'FAILED', `1300 payment reaches FAILED (got ${done2?.status})`);
  check(
    (await pollBalance(phone, expected)) === expected,
    `wallet credited back after FAILED — balance restored to ${expected}`
  );

  // -- INSUFFICIENT FUNDS -----------------------------------------------------
  const broke = await pay(9_999_999);
  check(broke.status === 402 && broke.body?.error?.code === 'INSUFFICIENT_FUNDS', 'oversized payment -> 402 INSUFFICIENT_FUNDS');
  check((await balance(phone)) === expected, 'insufficient-funds attempt moved no money');

  // -- webhook replay from the S3 inbox (ADR-4a) -------------------------------
  console.log('webhook replay (raw payload from the S3 inbox)');
  const s3 = new S3Client({ region: REGION });
  const prefix = `webhooks/mock/${new Date().toISOString().slice(0, 10)}/${state.successPaymentId}`;
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: ENV.inboxBucket, Prefix: prefix }));
  const inboxKey = listed.Contents?.[0]?.Key;
  check(Boolean(inboxKey), `raw callback landed in the inbox (${inboxKey ?? 'NOT FOUND'})`);
  if (inboxKey) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: ENV.inboxBucket, Key: inboxKey }));
    const rawPayload = await obj.Body.transformToString();
    const replay = await api('POST', '/v1/webhooks/mock', { raw: rawPayload });
    check(
      replay.status === 200 && replay.body?.duplicate === true,
      `replayed raw webhook -> 200 {"duplicate":true} (got ${replay.status} ${JSON.stringify(replay.body)})`
    );
    check((await balance(phone)) === expected, 'replay moved no money');
  }

  // -- device pairing + MQTT + exactly-one announcement ------------------------
  console.log('device: register -> pairing-code -> pair -> MQTT -> announce exactly once');
  const serial = `itest-${run}`;
  const reg = await api('POST', '/v1/devices', {
    admin: true,
    body: { serial_number: serial, device_type: 'VIRTUAL', notes: 'integration test — safe to delete' },
  });
  if (reg.status !== 201) fatal(`register device -> ${reg.status} ${JSON.stringify(reg.body)}`);
  state.deviceId = reg.body.device_id;
  check(true, `device registered (${state.deviceId})`);

  const codeRes = await api('POST', `/v1/devices/${state.deviceId}/pairing-code`, {
    admin: true,
    body: { merchant_id: state.merchantId },
  });
  check(codeRes.status === 200 && /^\d{6}$/.test(codeRes.body.pairing_code ?? ''), 'pairing code issued');

  const cfg = await api('GET', '/v1/soundbox/config');
  check(cfg.status === 200 && Boolean(cfg.body.identity_pool_id), 'soundbox config exposes the identity pool');

  const cognito = new CognitoIdentityClient({ region: cfg.body.region });
  const { IdentityId } = await cognito.send(new GetIdCommand({ IdentityPoolId: cfg.body.identity_pool_id }));
  check(Boolean(IdentityId), `fresh Cognito identity (${IdentityId})`);

  // wrong code is rejected before we use the real one
  const badPair = await api('POST', '/v1/devices/pair', {
    body: { serial_number: serial, pairing_code: '000000', identity_id: IdentityId },
  });
  check(badPair.status === 401, 'wrong pairing code -> 401');

  const pairRes = await api('POST', '/v1/devices/pair', {
    body: { serial_number: serial, pairing_code: codeRes.body.pairing_code, identity_id: IdentityId },
  });
  if (pairRes.status !== 200) fatal(`pair -> ${pairRes.status} ${JSON.stringify(pairRes.body)}`);
  check(pairRes.body.auth_mode === 'cognito' && Boolean(pairRes.body.topics?.payments), 'device paired via public endpoint');

  const reuse = await api('POST', '/v1/devices/pair', {
    body: { serial_number: serial, pairing_code: codeRes.body.pairing_code, identity_id: IdentityId },
  });
  check(reuse.status === 401, 'pairing code is single-use (second pair -> 401)');

  const { Credentials } = await cognito.send(new GetCredentialsForIdentityCommand({ IdentityId }));
  const wssUrl = signedIotUrl({
    endpoint: pairRes.body.iot_endpoint,
    region: pairRes.body.region,
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretKey,
    sessionToken: Credentials.SessionToken,
  });
  const client = await connectMqtt(wssUrl, pairRes.body.client_id);
  state.mqtt = client;
  check(true, `MQTT connected over WSS as ${pairRes.body.client_id}`);
  await new Promise((resolve, reject) =>
    client.subscribe(pairRes.body.topics.payments, { qos: 1 }, (err) => (err ? reject(err) : resolve()))
  );
  check(true, `subscribed to ${pairRes.body.topics.payments}`);

  // duplicate magic amount (222): callback delivered twice — the hardest announce-once case
  const announcements = [];
  const dupPay = await pay(222);
  check(dupPay.status === 201, 'duplicate-amount payment initiated (222)');
  client.on('message', (topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      if (msg.event_type === 'ANNOUNCE_PAYMENT' && msg.payment_id === dupPay.body.payment_id) {
        announcements.push(msg);
      }
    } catch {
      /* ignore non-JSON */
    }
  });

  const dupDone = await pollPayment(dupPay.body.payment_id);
  check(dupDone?.status === 'SUCCESS', `222 payment reaches SUCCESS despite double callback (got ${dupDone?.status})`);
  expected -= 222;
  check((await pollBalance(phone, expected)) === expected, `wallet debited exactly once for 222 (balance ${expected})`);

  // wait for the first announcement, then 10 extra seconds for any duplicate
  const firstBy = Date.now() + 30_000;
  while (announcements.length === 0 && Date.now() < firstBy) await sleep(500);
  check(announcements.length >= 1, 'announcement received over MQTT');
  console.log('    listening 10 more seconds for a duplicate announcement...');
  await sleep(10_000);
  check(
    announcements.length === 1,
    `EXACTLY one announcement for the double-delivered callback (got ${announcements.length})`
  );
  if (announcements[0]) {
    check(announcements[0].message?.includes('2.22'), `announcement speaks the amount ("${announcements[0].message}")`);
  }

  // -- TIMEOUT (999): still open shortly after creation; sweeper expires it later
  console.log('timeout amount (999) — sweeper territory, not awaited');
  const t = await pay(999);
  check(t.status === 201, 'timeout payment initiated (999)');
  state.timeoutPaymentId = t.body.payment_id;
  await sleep(8000);
  const tState = await api('GET', `/v1/payments/${t.body.payment_id}`);
  check(
    ['INITIATED', 'PENDING'].includes(tState.body?.status),
    `999 payment still non-terminal after 8s (got ${tState.body?.status}) — sweeper will EXPIRE + refund it in ~5-6 min (not awaited)`
  );
}

async function cleanup() {
  console.log('\ncleanup');
  try {
    if (state.mqtt) {
      state.mqtt.end(true);
      console.log('  - MQTT disconnected');
    }
    if (state.deviceId) {
      const del = await api('DELETE', `/v1/devices/${state.deviceId}`, { admin: true });
      console.log(`  - device ${state.deviceId} deleted (${del.status}) — IoT policy detached+deleted server-side`);
    }
    if (state.merchantId) {
      const sus = await api('PATCH', `/v1/merchants/${state.merchantId}/status`, {
        admin: true,
        body: { status: 'SUSPENDED', reason: 'integration test cleanup' },
      });
      console.log(`  - merchant ${state.merchantId} suspended (${sus.status}) — no delete endpoint exists`);
    }
    console.log('  - not deletable via API (by design): wallet record, payment ledger items, S3 inbox objects');
    if (state.timeoutPaymentId) {
      console.log(`  - payment ${state.timeoutPaymentId} (999) left for the sweeper to EXPIRE + refund`);
    }
  } catch (err) {
    console.error('  cleanup error (non-fatal):', err.message);
  }
}

try {
  await main();
} catch (err) {
  if (!failures.includes(err.message)) {
    failures.push(err.message);
    console.error(`\nUnexpected error: ${err.stack ?? err}`);
  }
} finally {
  await cleanup();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('Failures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
