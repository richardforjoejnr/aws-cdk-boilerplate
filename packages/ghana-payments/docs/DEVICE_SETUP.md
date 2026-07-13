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

### Raspberry Pi quickstart (turnkey, ~10 min from a fresh Pi)

On your laptop, provision the device and copy the bundle to the Pi:
```bash
# 1. Register a REAL device in the merchant portal (serial e.g. SBX-PI-001), click Pair…, copy the code
# 2. From the repo root:
./scripts/setup-real-device.sh dev SBX-PI-001 <pairing_code>
scp -r device-bundles/SBX-PI-001 pi@raspberrypi.local:~/soundbox
```

On the Pi (SSH in), install runtime + the one npm dep, and smoke-test:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs espeak alsa-utils
# grab just the client script (or clone the repo); it needs only 'mqtt'
cd ~/soundbox && npm init -y >/dev/null && npm i mqtt
# copy the client next to the bundle:
scp your-laptop:.../packages/ghana-payments/device-client/soundbox-client.mjs ~/soundbox/
# pick the audio output and set volume (3.5mm = card headphones; HDMI = card HDMI)
espeak "soundbox online"          # you should hear this
node soundbox-client.mjs SBX-PI-001   # connects, subscribes; scan a QR + pay -> it speaks
```

Make it auto-start on boot as a real appliance (`systemd`):
```bash
sudo tee /etc/systemd/system/soundbox.service >/dev/null <<'EOF'
[Unit]
Description=Ghana Payments Soundbox
After=network-online.target sound.target
Wants=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/soundbox
ExecStart=/usr/bin/node /home/pi/soundbox/soundbox-client.mjs SBX-PI-001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now soundbox
journalctl -u soundbox -f   # watch it connect + announce
```
Now the Pi behaves like a shipped soundbox: powers on → connects → announces payments, reconnects after network drops, replays announcements missed while offline. Remove it any time from the portal (**Remove**) — it self-unpairs and stops.

Audio tips: no sound? `sudo raspi-config` → System Options → Audio to pick 3.5 mm vs HDMI, and `alsamixer` to raise volume. A **USB speaker** works on any Pi (incl. Zero) with no config. For the field-test cellular device, add a 4G USB dongle/HAT and a data SIM — the client is transport-agnostic.

### What to buy (UK, for the PoC)

Any Pi with Node 20 + a speaker works. Best value/effort trade-off:

| Option | Why | Approx £ |
| --- | --- | --- |
| **Raspberry Pi 4 (2–4GB) starter kit** — *recommended* | Full-size ports + **3.5 mm audio jack** (plug any powered speaker straight in), kit includes PSU + SD-with-OS + case, so it's turnkey. Least friction. | ~£65–85 |
| **Raspberry Pi Zero 2 W + USB speaker** | Cheapest; capable, but no 3.5 mm jack (use a **USB speaker**) and fiddlier micro ports. | ~£30 |
| **USB or 3.5 mm powered speaker** | Any small powered speaker; USB ones need zero Pi audio config. | ~£8–12 |

- Pi 4 starter kit (CanaKit, UK): https://www.amazon.co.uk/CanaKit-Raspberry-4GB-Starter-Kit/dp/B07XH3HWTQ or https://www.amazon.co.uk/CanaKit-Raspberry-Pi-Starter-Kit/dp/B07V4G63M1
- Pi Zero 2 W (browse current UK listings): https://www.amazon.co.uk/raspberry-pi-zero-2-w/s?k=raspberry+pi+zero+2+w
- USB mini speaker (browse): search Amazon UK for "USB powered mini speaker"

Prices/stock shift — the links are entry points, not fixed offers. Avoid buying a **commercial MoMo/payment soundbox**: those are locked to their provider's cloud and can't connect to your IoT endpoint.

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
