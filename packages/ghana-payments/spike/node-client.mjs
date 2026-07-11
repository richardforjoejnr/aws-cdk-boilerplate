// Phase 0 spike — headless verifier for the Cognito -> IoT Core MQTT-WSS auth path.
// Usage: node spike/node-client.mjs   (reads spike/.env written by configure.sh)
// Exits 0 once a message is received on spike/announce, 1 on failure/timeout.
import { readFileSync } from 'node:fs';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mqtt from 'mqtt';
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from '@aws-sdk/client-cognito-identity';

const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim()))
);

const { REGION, IDENTITY_POOL_ID, ATTACH_URL, IOT_ENDPOINT } = env;

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

// SigV4-presigned wss URL for IoT device gateway (service: iotdevicegateway)
function signedIotUrl({ endpoint, region, accessKeyId, secretAccessKey, sessionToken }) {
  const now = new Date();
  const amzdate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const date = amzdate.slice(0, 8);
  const service = 'iotdevicegateway';
  const scope = `${date}/${region}/${service}/aws4_request`;
  const query =
    'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    `&X-Amz-Credential=${encodeURIComponent(`${accessKeyId}/${scope}`)}` +
    `&X-Amz-Date=${amzdate}` +
    '&X-Amz-SignedHeaders=host';
  const canonicalRequest = ['GET', '/mqtt', query, `host:${endpoint}`, '', 'host', sha256('')].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzdate, scope, sha256(canonicalRequest)].join('\n');
  let key = hmac(`AWS4${secretAccessKey}`, date);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  let url = `wss://${endpoint}/mqtt?${query}&X-Amz-Signature=${signature}`;
  if (sessionToken) url += `&X-Amz-Security-Token=${encodeURIComponent(sessionToken)}`;
  return url;
}

const cognito = new CognitoIdentityClient({ region: REGION });
const { IdentityId } = await cognito.send(new GetIdCommand({ IdentityPoolId: IDENTITY_POOL_ID }));
console.log(`[1] Cognito identity: ${IdentityId}`);

const attachRes = await fetch(ATTACH_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identityId: IdentityId }),
});
console.log(`[2] AttachPolicy: HTTP ${attachRes.status} ${await attachRes.text()}`);
if (!attachRes.ok) process.exit(1);

const { Credentials } = await cognito.send(
  new GetCredentialsForIdentityCommand({ IdentityId })
);
console.log('[3] Got temporary AWS credentials');

const url = signedIotUrl({
  endpoint: IOT_ENDPOINT,
  region: REGION,
  accessKeyId: Credentials.AccessKeyId,
  secretAccessKey: Credentials.SecretKey,
  sessionToken: Credentials.SessionToken,
});

const clientId = `spike-node-${randomUUID().slice(0, 8)}`;
const client = mqtt.connect(url, {
  clientId,
  protocolVersion: 4,
  clean: true,
  connectTimeout: 15000,
  reconnectPeriod: 0,
});

const timeout = setTimeout(() => {
  console.error('[!] Timed out waiting for a message on spike/announce');
  client.end(true);
  process.exit(1);
}, 90000);

client.on('connect', () => {
  console.log(`[4] MQTT connected over WSS as ${clientId}`);
  client.subscribe('spike/announce', { qos: 1 }, (err) => {
    if (err) {
      console.error('[!] Subscribe failed:', err.message);
      process.exit(1);
    }
    console.log('[5] Subscribed to spike/announce — waiting for a published message...');
    console.log('    (publish with: aws iot-data publish --topic spike/announce --cli-binary-format raw-in-base64-out --payload \'{"message":"test"}\')');
  });
});

client.on('message', (topic, payload) => {
  console.log(`[6] RECEIVED on ${topic}: ${payload.toString()}`);
  clearTimeout(timeout);
  client.publish('spike/ack', JSON.stringify({ clientId, at: new Date().toISOString() }), { qos: 1 }, () => {
    console.log('[7] Ack published to spike/ack — spike auth path VERIFIED');
    client.end();
    process.exit(0);
  });
});

client.on('error', (err) => {
  console.error('[!] MQTT error:', err.message);
  process.exit(1);
});
