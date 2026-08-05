#!/usr/bin/env node
// Integration suite for the DEPLOYED Ghana Payments dev environment — the FLEET
// path the legacy run.mjs doesn't cover: IoT Fleet Provisioning by Claim, remote
// store assignment, merchant payment_methods, the payment→announce loop on the
// Thing-name topic, and the /v1/observability/* endpoints.
//
// Plain Node (no jest). Drives the live stack via CloudFront /api and real AWS IoT
// MQTT (mutual TLS, X.509). Mints its own claim + device certs and cleans them up.
//
// Usage:   npm run test:integration:fleet        (from apps/ghana-payments)
// Skips (exit 0) when AWS creds / the dev stacks are absent, so CI stays green.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mqtt from 'mqtt';

const exec = promisify(execFile);
const STAGE = process.env.STAGE ?? 'dev';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── tiny harness ────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];
const check = (cond, name) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}`); }
};
const fatal = (name) => { failures.push(name); throw new Error(name); };
async function skip(reason) {
  console.warn(`\n[SKIP] ${reason}`);
  console.warn('[SKIP] Fleet integration tests need AWS credentials + the deployed dev stacks.');
  process.exit(0);
}

async function awsJson(args) {
  const { stdout } = await exec('aws', [...args, '--region', REGION, '--output', 'json']);
  return stdout.trim() ? JSON.parse(stdout) : {};
}
const outputs = async (stack) =>
  Object.fromEntries(
    ((await awsJson(['cloudformation', 'describe-stacks', '--stack-name', stack])).Stacks?.[0]?.Outputs ?? []).map(
      (o) => [o.OutputKey, o.OutputValue]
    )
  );

// ── environment resolution ───────────────────────────────────────────────────
async function resolveEnv() {
  try { await exec('aws', ['sts', 'get-caller-identity', '--region', REGION]); }
  catch (err) { await skip(err.code === 'ENOENT' ? 'aws CLI not found' : 'no usable AWS credentials'); }
  let web, api, fleet;
  try {
    [web, api, fleet] = await Promise.all([
      outputs(`${STAGE}-ghana-payments-web`),
      outputs(`${STAGE}-ghana-payments-api`),
      outputs(`${STAGE}-ghana-payments-fleet`),
    ]);
  } catch { await skip(`ghana-payments ${STAGE} stacks not deployed`); }
  const portalUrl = web.PortalUrl?.replace(/\/$/, '');
  const template = fleet.ProvisioningTemplateName;
  const claimPolicy = fleet.ClaimPolicyName;
  if (!portalUrl || !api.AdminApiKeyId || !template || !claimPolicy) await skip('expected stack outputs missing');
  const key = await awsJson(['apigateway', 'get-api-key', '--api-key', api.AdminApiKeyId, '--include-value']);
  const ep = await awsJson(['iot', 'describe-endpoint', '--endpoint-type', 'iot:Data-ATS']);
  const acct = await awsJson(['sts', 'get-caller-identity']);
  return { portalUrl, adminKey: key.value, template, claimPolicy, iotEndpoint: ep.endpointAddress, account: acct.Account };
}

let ENV;
async function api(method, path, { body, admin = false } = {}) {
  const res = await fetch(`${ENV.portalUrl}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(admin ? { 'x-api-key': ENV.adminKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}
async function listDevices() {
  return (await api('GET', '/v1/devices', { admin: true })).body?.devices ?? [];
}
async function findDevice(serial) {
  return (await listDevices()).find((d) => d.serial_number === serial);
}
async function pollPayment(id, timeoutMs = 45_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = (await api('GET', `/v1/payments/${id}`)).body;
    if (last && ['SUCCESS', 'FAILED', 'EXPIRED'].includes(last.status)) return last;
    await sleep(2000);
  }
  return last;
}

// ── request/response over the AWS IoT provisioning MQTT topics ───────────────
function mqttRequest(client, base, payload) {
  return new Promise((resolve, reject) => {
    const accepted = `${base}/accepted`;
    const rejected = `${base}/rejected`;
    const onMsg = (t, buf) => {
      if (t !== accepted && t !== rejected) return;
      client.removeListener('message', onMsg);
      let b = {};
      try { b = JSON.parse(buf.toString()); } catch { /* keep {} */ }
      t === accepted ? resolve(b) : reject(new Error(`${t}: ${JSON.stringify(b)}`));
    };
    client.on('message', onMsg);
    client.subscribe([accepted, rejected], { qos: 1 }, (err) => {
      if (err) return reject(err);
      client.publish(base, JSON.stringify(payload), { qos: 1 });
    });
  });
}
const connectCert = (dir, certFile, keyFile, clientId, clean = true) =>
  new Promise((resolve, reject) => {
    const c = mqtt.connect(`mqtts://${ENV.iotEndpoint}:8883`, {
      clientId, protocolVersion: 4, clean,
      cert: readFileSync(join(dir, certFile)),
      key: readFileSync(join(dir, keyFile)),
      ca: readFileSync(join(dir, 'rootCA.pem')),
      connectTimeout: 10_000, reconnectPeriod: 0,
    });
    c.once('connect', () => resolve(c));
    c.once('error', reject);
  });

const run = randomUUID().slice(0, 8);
const state = {};

async function main() {
  ENV = await resolveEnv();
  console.log(`\nGhana Payments FLEET integration suite — ${STAGE} @ ${ENV.portalUrl}\n`);
  const dir = mkdtempSync(join(tmpdir(), 'ghana-itest-'));
  const rootCA = await (await fetch('https://www.amazontrust.com/repository/AmazonRootCA1.pem')).text();
  writeFileSync(join(dir, 'rootCA.pem'), rootCA);
  const serial = `ITEST-${run}`;

  // -- 1. manufacture (allow-list) -------------------------------------------
  console.log('fleet provisioning by claim');
  const man = await api('POST', '/v1/fleet/serials', { admin: true, body: { serials: [serial] } });
  check(man.status === 201 && man.body.manufactured?.includes(serial), 'serial recorded in the manufactured allow-list');
  const manufactured = await findDevice(serial);
  check(manufactured?.status === 'MANUFACTURED', `device shows MANUFACTURED (got ${manufactured?.status})`);

  // -- 2. mint a claim cert + attach the fleet claim policy -------------------
  const claim = await awsJson([
    'iot', 'create-keys-and-certificate', '--set-as-active',
    '--certificate-pem-outfile', join(dir, 'claim.pem'),
    '--private-key-outfile', join(dir, 'claim.key'),
    '--public-key-outfile', join(dir, 'claim.pub'),
  ]);
  state.claimCertArn = claim.certificateArn;
  state.claimCertId = claim.certificateId;
  await exec('aws', ['iot', 'attach-policy', '--policy-name', ENV.claimPolicy, '--target', claim.certificateArn, '--region', REGION]);
  check(true, 'claim certificate minted + claim policy attached');

  // -- 3. run the real claim→provision MQTT flow -----------------------------
  const claimClient = await connectCert(dir, 'claim.pem', 'claim.key', `provision-${serial}-${Date.now()}`);
  const cert = await mqttRequest(claimClient, '$aws/certificates/create/json', {});
  writeFileSync(join(dir, 'device.pem'), cert.certificatePem);
  writeFileSync(join(dir, 'device.key'), cert.privateKey);
  state.deviceCertId = cert.certificateId;
  const reg = await mqttRequest(
    claimClient,
    `$aws/provisioning-templates/${ENV.template}/provision/json`,
    { certificateOwnershipToken: cert.certificateOwnershipToken, parameters: { SerialNumber: serial } }
  );
  claimClient.end(true);
  state.thingName = reg.thingName ?? `soundbox-${serial}`;
  check(state.thingName === `soundbox-${serial}`, `provisioned as Thing ${state.thingName}`);

  const provisioned = await findDevice(serial);
  check(provisioned?.status === 'PROVISIONED', `device advanced to PROVISIONED (got ${provisioned?.status})`);
  check(provisioned?.merchant_id == null, 'provisioned device is unassigned (no merchant)');
  state.deviceId = provisioned.device_id;

  // -- 4. merchant with payment_methods --------------------------------------
  console.log('store onboarding + payment methods');
  const bad = await api('POST', '/v1/merchants', { admin: true, body: { display_name: 'X', phone: '0200000000', payment_methods: ['BITCOIN'] } });
  check(bad.status === 400, 'unsupported payment method -> 400');
  const merch = await api('POST', '/v1/merchants', {
    admin: true,
    body: { display_name: `Fleet Test ${run}`, phone: `0244${Date.now().toString().slice(-6)}`, payment_methods: ['MTN_MOMO', 'CARD'] },
  });
  if (merch.status !== 201) fatal(`create merchant -> ${merch.status}`);
  state.merchantId = merch.body.merchant_id;
  check(JSON.stringify(merch.body.payment_methods) === JSON.stringify(['MTN_MOMO', 'CARD']), 'merchant stores chosen payment_methods');

  // -- 5. remote assign (no device interaction) ------------------------------
  const notReady = await api('POST', `/v1/devices/${state.deviceId}/assign`, { admin: true, body: { merchant_id: 'mer_nope' } });
  check(notReady.status === 404, 'assign to a missing merchant -> 404');
  const assign = await api('POST', `/v1/devices/${state.deviceId}/assign`, { admin: true, body: { merchant_id: state.merchantId } });
  check(assign.status === 200 && assign.body.status === 'ACTIVE', 'device assigned to the store (ACTIVE)');

  // -- 6. connect AS the device, pay, expect an announcement on the Thing topic
  console.log('pay → announce on the Thing-name topic (regression guard)');
  const device = await connectCert(dir, 'device.pem', 'device.key', state.thingName, false);
  state.mqtt = device;
  const paymentsTopic = `devices/${state.thingName}/payments`;
  await new Promise((res, rej) => device.subscribe(paymentsTopic, { qos: 1 }, (e) => (e ? rej(e) : res())));
  check(true, `device connected + subscribed on ${paymentsTopic}`);
  const announcements = [];
  device.on('message', (t, p) => {
    try { const m = JSON.parse(p.toString()); if (m.event_type === 'ANNOUNCE_PAYMENT') announcements.push(m); } catch { /* */ }
  });

  const phone = `024${Date.now().toString().slice(-7)}`;
  await api('POST', `/v1/wallets/${phone}/topup`, { body: { amount_pesewas: 50_000 } });
  const pay = await api('POST', '/v1/payments', { body: { merchant_id: state.merchantId, amount_pesewas: 12_000, payer_phone: phone } });
  check(pay.status === 201, 'payment initiated (12000)');
  state.paymentId = pay.body.payment_id;
  const done = await pollPayment(state.paymentId);
  check(done?.status === 'SUCCESS', `payment reaches SUCCESS (got ${done?.status})`);

  const by = Date.now() + 25_000;
  while (announcements.length === 0 && Date.now() < by) await sleep(500);
  check(announcements.length >= 1, 'announcement received on the fleet Thing-name topic');
  if (announcements[0]) check(announcements[0].message?.includes('120.00'), `announcement speaks the amount ("${announcements[0].message}")`);

  // -- 7. observability endpoints reflect the flow ---------------------------
  console.log('observability endpoints');
  await sleep(4000); // let the audit-writer roll up
  const overview = await api('GET', '/v1/observability/overview?days=7', { admin: true });
  check(overview.status === 200 && overview.body.totals?.transactions >= 1, `overview shows transactions (${overview.body?.totals?.transactions})`);
  check((overview.body?.totals?.volume_pesewas ?? 0) >= 12_000, 'overview volume includes the payment');

  const trace = await api('GET', `/v1/observability/trace/${state.paymentId}`, { admin: true });
  const types = (trace.body?.timeline ?? []).map((e) => e.event_type);
  check(trace.status === 200 && types.includes('PAYMENT_CONFIRMED') && types.includes('ANNOUNCEMENT_PUBLISHED'),
    `trace has the lifecycle (${types.join(' → ')})`);

  const fleet = await api('GET', '/v1/observability/fleet', { admin: true });
  check(fleet.status === 200 && fleet.body.devices?.some((d) => d.device_id === state.deviceId), 'fleet view lists the device');

  const fails = await api('GET', '/v1/observability/failures', { admin: true });
  check(fails.status === 200 && typeof fails.body.dlq_depths === 'object', 'failures endpoint returns DLQ depths');

  // -- 8. unassign ------------------------------------------------------------
  const un = await api('POST', `/v1/devices/${state.deviceId}/unassign`, { admin: true });
  check(un.status === 200 && un.body.status === 'PROVISIONED', 'device unassigned back to PROVISIONED');
}

async function cleanup() {
  console.log('\ncleanup');
  try {
    if (state.mqtt) state.mqtt.end(true);
    if (state.deviceId) await api('DELETE', `/v1/devices/${state.deviceId}`, { admin: true });
    // detach + delete the fleet device + claim certs and the Thing we created
    for (const [certId, arn] of [
      [state.deviceCertId, state.deviceCertId && `arn:aws:iot:${REGION}:${ENV.account}:cert/${state.deviceCertId}`],
      [state.claimCertId, state.claimCertArn],
    ]) {
      if (!certId) continue;
      try {
        const targets = await awsJson(['iot', 'list-principal-things', '--principal', arn]);
        for (const thing of targets.things ?? []) {
          await exec('aws', ['iot', 'detach-thing-principal', '--thing-name', thing, '--principal', arn, '--region', REGION]).catch(() => {});
          await exec('aws', ['iot', 'delete-thing', '--thing-name', thing, '--region', REGION]).catch(() => {});
        }
        await exec('aws', ['iot', 'update-certificate', '--certificate-id', certId, '--new-status', 'INACTIVE', '--region', REGION]).catch(() => {});
        await exec('aws', ['iot', 'delete-certificate', '--certificate-id', certId, '--force-delete', '--region', REGION]).catch(() => {});
      } catch { /* best effort */ }
    }
    console.log('  - device deleted; fleet + claim certs and Thing removed');
  } catch (err) {
    console.error('  cleanup error (non-fatal):', err.message);
  }
}

try { await main(); }
catch (err) { if (!failures.includes(err.message)) { failures.push(err.message); console.error(`\nUnexpected error: ${err.stack ?? err}`); } }
finally { await cleanup(); }

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) { console.error('Failures:'); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
process.exit(0);
