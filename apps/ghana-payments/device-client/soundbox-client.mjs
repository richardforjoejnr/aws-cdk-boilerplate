// Real-device soundbox client — runs on anything with Node 20+ and a speaker
// (laptop, Raspberry Pi). Connects to AWS IoT Core over MQTT/TLS (port 8883)
// using the X.509 cert bundle produced by scripts/setup-real-device.sh, and
// SPEAKS payment announcements via the OS text-to-speech (macOS `say`,
// Linux `espeak`/`spd-say`; falls back to console + bell).
//
// Usage: node soundbox-client.mjs <bundle-dir>   (dir containing device.json + certs)
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { platform } from 'node:os';
import mqtt from 'mqtt';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node soundbox-client.mjs <bundle-dir>');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(join(dir, 'device.json'), 'utf8'));

function speak(text) {
  const tries =
    platform() === 'darwin'
      ? [['say', [text]]]
      : [['spd-say', [text]], ['espeak', [text]]];
  const attempt = (i) => {
    if (i >= tries.length) {
      console.log(`🔊 (no TTS found) ${text}`);
      return;
    }
    execFile(tries[i][0], tries[i][1], (err) => err && attempt(i + 1));
  };
  attempt(0);
}

const seen = new Set();
const client = mqtt.connect(`mqtts://${cfg.iot_endpoint}:8883`, {
  clientId: cfg.client_id,
  protocolVersion: 4,
  clean: false, // real device: persistent session so missed announcements replay
  cert: readFileSync(join(dir, cfg.files.certificate)),
  key: readFileSync(join(dir, cfg.files.private_key)),
  ca: readFileSync(join(dir, cfg.files.root_ca)),
  reconnectPeriod: 3000,
});

client.on('connect', () => {
  console.log(`[soundbox] connected to ${cfg.iot_endpoint} as ${cfg.client_id}`);
  client.subscribe([cfg.topics.payments, cfg.topics.commands], { qos: 1 }, (err) => {
    if (err) return console.error('[soundbox] subscribe failed:', err.message);
    console.log(`[soundbox] listening on ${cfg.topics.payments}`);
    client.publish(cfg.topics.heartbeat, JSON.stringify({ status: 'online', battery: 100 }), { qos: 1 });
  });
});

client.on('message', (topic, payload) => {
  let msg;
  try { msg = JSON.parse(payload.toString()); } catch { return; }
  if (topic === cfg.topics.payments && msg.event_type === 'ANNOUNCE_PAYMENT') {
    if (msg.payment_id && seen.has(msg.payment_id)) {
      console.log(`[soundbox] duplicate ${msg.payment_id} ignored`);
      return;
    }
    if (msg.payment_id) seen.add(msg.payment_id);
    console.log(`[soundbox] 🔊 ${msg.message}`);
    speak(msg.message);
    client.publish(cfg.topics.heartbeat, JSON.stringify({ status: 'played', payment_id: msg.payment_id }), { qos: 1 });
  } else if (topic === cfg.topics.commands) {
    if (msg.event_type === 'TEST_ANNOUNCEMENT') speak('Test announcement. Soundbox is working.');
    console.log('[soundbox] command:', JSON.stringify(msg));
  }
});

client.on('error', (e) => console.error('[soundbox] error:', e.message));
client.on('close', () => console.log('[soundbox] disconnected — retrying'));

setInterval(() => {
  if (client.connected) {
    client.publish(cfg.topics.heartbeat, JSON.stringify({ status: 'online', battery: 100 }), { qos: 1 });
  }
}, 60_000);
