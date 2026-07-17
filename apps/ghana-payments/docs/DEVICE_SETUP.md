# Real Soundbox Device Setup

How to pair **actual hardware** as a soundbox, alongside the browser simulator. Real devices authenticate with an **X.509 certificate over MQTT/TLS (port 8883)** — not the browser's Cognito path — and the pair endpoint accepts either (`identity_id` for virtual, `certificate_arn` for real). The per-device IoT policy is attached to the certificate, so the device can only touch its own `devices/{device_id}/*` topics.

## Option A — Laptop or Raspberry Pi as the soundbox (recommended, ~5 minutes)

A Pi with a speaker *is* a soundbox — this exercises the exact production device path (cert auth, port 8883, persistent session with offline replay).

1. **Register the device** — merchant portal → *Soundbox devices* → type **Real hardware** → serial e.g. `SBX-PI-001` (+ optional firmware/notes) → Register.
2. **Get a pairing code** — click **Pair…**, choose the merchant. (The **Info** button on the device row shows all connection details any time.)
3. **Provision + pair in one step** (from the repo root, within the 10-minute code window):
   ```bash
   ./scripts/setup-real-device.sh dev SBX-PI-001 <pairing_code>
   ```
   This creates the certificate + keys, downloads the Amazon Root CA, calls the pair endpoint with the certificate ARN, and writes everything to `device-bundles/SBX-PI-001/` (certs + `device.json` with endpoint, client id, topics). If pairing fails the orphaned cert is deactivated and deleted automatically.
4. **Run the soundbox** (on this machine, or copy the bundle folder to a Pi first):
   ```bash
   node packages/ghana-payments/device-client/soundbox-client.mjs device-bundles/SBX-PI-001
   ```
   TTS uses macOS `say` or Linux `espeak`/`spd-say` (`sudo apt install espeak` on a Pi). It heartbeats every 60 s (device shows ACTIVE in the portal) and, unlike the browser, uses a **persistent session** — announcements missed while offline replay on reconnect.
5. **Test:** scan the merchant's QR and pay — the machine speaks. Or press **Test** in the portal.

Raspberry Pi notes: any Pi with Node 20+ (`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs espeak`), a speaker on the 3.5 mm jack or HDMI, and the bundle folder copied over (`scp -r device-bundles/SBX-PI-001 pi@host:`). The client needs only `mqtt` from npm (`npm i mqtt` next to the bundle if not running from the repo).

## Option B — ESP32 soundbox (the concept §17.7 hardware)

Hardware: ESP32 dev board + I2S amplifier (e.g. MAX98357A) + small speaker, or start with the serial console as "audio".

1. Register (type **Real hardware**) + pairing code + `setup-real-device.sh` exactly as Option A — the bundle's cert files and `device.json` are what you flash/configure.
2. Firmware: start from the sketch in `docs/concept.md` §17.7, with these changes for AWS IoT:
   - `WiFiClientSecure` with the three PEMs from the bundle (`setCACert`, `setCertificate`, `setPrivateKey`); connect `PubSubClient` to `device.json`'s `iot_endpoint` **port 8883**.
   - `CLIENT_ID` = `client_id` from `device.json` (`soundbox-{device_id}`); topics also from `device.json`.
   - AWS IoT requires MQTT 3.1.1 and messages < 128 KB; keepalive ≥ 30 s recommended.
   - Dedupe announcements by `payment_id` (keep the last few ids) — QoS 1 can redeliver.
3. Audio: `announcePayment()` → I2S playback of stored prompts, or a TTS module. Serial `Serial.println` is fine for a first bring-up.

## Verifying / troubleshooting

- **Portal:** device row shows PAIRED → ACTIVE after the first heartbeat, with last-seen time. **Info** shows endpoint/client-id/topics.
- **Connection refused / immediate disconnect:** clientId must be exactly `soundbox-{device_id}` (the policy restricts it), and only one connection per clientId — a second connection evicts the first.
- **Subscribed but silent:** check the device is PAIRED/ACTIVE to the *same merchant* being paid; `aws logs tail /aws/lambda/dev-ghana-device-announcer --since 10m`.
- **Cert hygiene:** each pairing run creates a fresh cert. List: `aws iot list-certificates`. The destroy pipeline cleans per-device policies; orphaned certs from real devices can be deactivated with `aws iot update-certificate --certificate-id <id> --new-status INACTIVE` then deleted.
- **Re-pairing** the same serial to another merchant: generate a new code and re-run pairing; the policy already exists (handled) and the new merchant binding replaces the old.
