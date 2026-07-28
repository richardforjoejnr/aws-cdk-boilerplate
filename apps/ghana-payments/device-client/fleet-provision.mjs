// Soundbox fleet-provisioning client — runs the SAME AWS IoT "Fleet Provisioning
// by Claim" flow a real device runs, so you can watch and test the whole thing
// on a laptop (a "virtual" soundbox) or on a Raspberry Pi (a "real" one).
//
// It uses the shared CLAIM cert (the one baked into firmware) to:
//   1. ask IoT for its OWN unique X.509 certificate,
//   2. register itself against the provisioning template (serial-gated by the
//      pre-provisioning hook), receiving a Thing name `soundbox-<serial>`,
//   3. save that per-device bundle, then reconnect AS the device and listen for
//      payment announcements on devices/<thing>/payments.
//
// Usage:
//   node fleet-provision.mjs <claim-bundle-dir> <serial> [--provision-only]
//
// <claim-bundle-dir> holds: claim.cert.pem, claim.private.key, AmazonRootCA1.pem,
// and claim.json = { iot_endpoint, region, template_name }.  Produced by
// scripts/provision-claim.sh — this is what ships inside every unit.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { platform } from 'node:os';
import mqtt from 'mqtt';

const [claimDir, serial, ...flags] = process.argv.slice(2);
if (!claimDir || !serial) {
  console.error('usage: node fleet-provision.mjs <claim-bundle-dir> <serial> [--provision-only]');
  process.exit(1);
}
const provisionOnly = flags.includes('--provision-only');
const claim = JSON.parse(readFileSync(join(claimDir, 'claim.json'), 'utf8'));
const endpoint = claim.iot_endpoint;
const template = claim.template_name;
const outDir = join('device-bundles', serial);

const step = (n, msg) => console.log(`\x1b[36m[${n}]\x1b[0m ${msg}`);

// Promise that resolves on the first message to `topic/accepted` and rejects on
// `topic/rejected` — the request/response shape of the IoT provisioning API.
function request(client, base, payload) {
  return new Promise((resolve, reject) => {
    const accepted = `${base}/accepted`;
    const rejected = `${base}/rejected`;
    const onMsg = (t, buf) => {
      if (t !== accepted && t !== rejected) return;
      client.removeListener('message', onMsg);
      let body = {};
      try { body = JSON.parse(buf.toString()); } catch { /* keep {} */ }
      t === accepted ? resolve(body) : reject(new Error(`${t}: ${JSON.stringify(body)}`));
    };
    client.on('message', onMsg);
    client.subscribe([accepted, rejected], { qos: 1 }, (err) => {
      if (err) return reject(err);
      client.publish(base, JSON.stringify(payload), { qos: 1 });
    });
  });
}

async function provision() {
  step('1/5', `connecting with the CLAIM certificate to ${endpoint}`);
  const claimClient = mqtt.connect(`mqtts://${endpoint}:8883`, {
    clientId: `provision-${serial}-${Date.now()}`,
    protocolVersion: 4,
    cert: readFileSync(join(claimDir, 'claim.cert.pem')),
    key: readFileSync(join(claimDir, 'claim.private.key')),
    ca: readFileSync(join(claimDir, 'AmazonRootCA1.pem')),
    reconnectPeriod: 0,
  });
  await new Promise((res, rej) => {
    claimClient.once('connect', res);
    claimClient.once('error', rej);
  });

  step('2/5', 'requesting a unique device certificate');
  const cert = await request(claimClient, '$aws/certificates/create/json', {});
  // cert = { certificateId, certificatePem, privateKey, certificateOwnershipToken }

  step('3/5', `registering with template "${template}" (serial ${serial})`);
  const reg = await request(
    claimClient,
    `$aws/provisioning-templates/${template}/provision/json`,
    { certificateOwnershipToken: cert.certificateOwnershipToken, parameters: { SerialNumber: serial } }
  );
  const thingName = reg.thingName ?? `soundbox-${serial}`;

  step('4/5', `provisioned as Thing "${thingName}" — saving the device bundle`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'device.cert.pem'), cert.certificatePem);
  writeFileSync(join(outDir, 'device.private.key'), cert.privateKey);
  writeFileSync(join(outDir, 'AmazonRootCA1.pem'), readFileSync(join(claimDir, 'AmazonRootCA1.pem')));
  const device = {
    iot_endpoint: endpoint,
    region: claim.region,
    thing_name: thingName,
    client_id: thingName,
    topics: {
      payments: `devices/${thingName}/payments`,
      commands: `devices/${thingName}/commands`,
      heartbeat: `devices/${thingName}/heartbeat`,
    },
    files: { certificate: 'device.cert.pem', private_key: 'device.private.key', root_ca: 'AmazonRootCA1.pem' },
  };
  writeFileSync(join(outDir, 'device.json'), JSON.stringify(device, null, 2));
  claimClient.end(true);
  return device;
}

function speak(text) {
  const tries = platform() === 'darwin' ? [['say', [text]]] : [['spd-say', [text]], ['espeak', [text]]];
  const attempt = (i) =>
    i >= tries.length ? console.log(`🔊 (no TTS) ${text}`) : execFile(tries[i][0], tries[i][1], (e) => e && attempt(i + 1));
  attempt(0);
}

function listen(device) {
  step('5/5', `connecting AS the device and listening on ${device.topics.payments}`);
  const seen = new Set();
  const client = mqtt.connect(`mqtts://${device.iot_endpoint}:8883`, {
    clientId: device.client_id,
    protocolVersion: 4,
    clean: false,
    cert: readFileSync(join(outDir, device.files.certificate)),
    key: readFileSync(join(outDir, device.files.private_key)),
    ca: readFileSync(join(outDir, device.files.root_ca)),
    reconnectPeriod: 3000,
  });
  client.on('connect', () => {
    client.subscribe([device.topics.payments, device.topics.commands], { qos: 1 }, (err) => {
      if (err) return console.error('subscribe failed:', err.message);
      console.log(`\x1b[32m✓ live\x1b[0m — waiting for payments. Assign this device to a store, then pay.`);
      client.publish(device.topics.heartbeat, JSON.stringify({ status: 'online' }), { qos: 1 });
    });
  });
  client.on('message', (topic, payload) => {
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch { return; }
    if (topic === device.topics.payments && msg.event_type === 'ANNOUNCE_PAYMENT') {
      if (msg.payment_id && seen.has(msg.payment_id)) return console.log(`duplicate ${msg.payment_id} ignored`);
      if (msg.payment_id) seen.add(msg.payment_id);
      console.log(`\x1b[32m🔊 ${msg.message}\x1b[0m`);
      speak(msg.message);
    } else if (topic === device.topics.commands) {
      if (msg.event_type === 'TEST_ANNOUNCEMENT') speak('Test announcement. Soundbox is working.');
      console.log('command:', JSON.stringify(msg));
    }
  });
  client.on('error', (e) => console.error('error:', e.message));
}

provision()
  .then((device) => {
    console.log(`\n\x1b[32m✓ Provisioned\x1b[0m  serial=${serial}  thing=${device.thing_name}`);
    console.log(`  bundle: ${outDir}/  (device.json + certs)`);
    if (provisionOnly) {
      console.log(`  run later: node fleet-provision.mjs ${claimDir} ${serial}   (or soundbox-client.mjs ${outDir})`);
      process.exit(0);
    }
    listen(device);
  })
  .catch((err) => {
    console.error(`\x1b[31m✗ provisioning failed:\x1b[0m ${err.message}`);
    console.error('  (is the serial in the manufactured allow-list? POST /v1/fleet/serials)');
    process.exit(1);
  });
