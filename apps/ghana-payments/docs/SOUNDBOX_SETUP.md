# Getting a physical soundbox ready (fleet provisioning)

How to prepare a real soundbox so it self‑provisions on first boot and can then be
paired to any store remotely. This is the hardware counterpart to
[`docs/planning/FLEET_PROVISIONING.md`](./planning/FLEET_PROVISIONING.md).

The idea: **every unit is flashed with the same three things** — the shared claim
certificate, the platform config, and its own serial number. On first boot over
WiFi it swaps the claim cert for its own unique certificate automatically. Nothing
about a specific store is on the device — that pairing happens later, remotely.

---

## 0. One‑time platform setup (you do this once)

```bash
cd apps/ghana-payments
STAGE=dev ./scripts/deploy.sh dev          # deploys the fleet stack too
./scripts/provision-claim.sh dev           # → claim-bundle/ (the firmware credential)
```

`claim-bundle/` now contains what goes on **every** device:

| File | What it is |
|------|-----------|
| `claim.cert.pem` | shared claim certificate (provisioning‑only) |
| `claim.private.key` | its private key |
| `AmazonRootCA1.pem` | Amazon's root CA (to trust IoT) |
| `claim.json` | `iot_endpoint`, `region`, `template_name` |

Record the serials you're about to flash into the allow‑list (the pre‑provisioning
hook refuses any serial that isn't here):

```bash
curl -s -X POST "${API}v1/fleet/serials" -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"serials":["SBX-0001","SBX-0002"]}'
```

---

## Path A — Raspberry Pi soundbox (fastest to try a real unit)

If your soundbox is a Pi (or you're testing with one + a speaker), it runs the
**same** client as the virtual demo.

1. Install Node 20+ and copy the app's `device-client/` folder + `claim-bundle/` to
   the Pi.
2. Connect the Pi to WiFi and a speaker.
3. Provision + go live (use the unit's real serial, which must be in the allow‑list):

```bash
node fleet-provision.mjs claim-bundle SBX-0001
```

   You'll see it request its own cert, register as `soundbox-SBX-0001`, save a
   `device-bundles/SBX-0001/` bundle, then connect and wait for payments. On boot
   thereafter, run `node soundbox-client.mjs device-bundles/SBX-0001` (it already
   has its own cert — no re‑provisioning).
4. Auto‑start on boot (optional): a `systemd` service running the `soundbox-client`
   command, so the unit is plug‑and‑play.

---

## Path B — ESP32 soundbox (production firmware)

For an ESP32‑class device, the same flow is implemented in firmware with the
**AWS IoT Device SDK for Embedded C** (or ESP‑IDF + the AWS IoT component), which
has a ready fleet‑provisioning‑by‑claim example.

**What to bake into the image / flash partition:**

- `claim.cert.pem`, `claim.private.key`, `AmazonRootCA1.pem` (from `claim-bundle/`).
- Config: the `iot_endpoint`, `region`, and `template_name` from `claim.json`.
- The unit's **serial** — ideally burned into a secure/eFuse or NVS partition per
  unit at the production line (so each image is otherwise identical).

**Firmware first‑boot logic (mirrors `fleet-provision.mjs`):**

1. Join WiFi (ship with a provisioning portal / captive AP for the store's WiFi, or
   pre‑configure it).
2. TLS‑connect to `iot_endpoint:8883` with the claim cert.
3. Subscribe/publish `$aws/certificates/create/json` → receive the device cert +
   private key + ownership token.
4. Publish `$aws/provisioning-templates/<template_name>/provision/json` with
   `{ "certificateOwnershipToken": …, "parameters": { "SerialNumber": "<serial>" } }`.
5. On `…/accepted`, **persist the new cert + key to NVS** and mark provisioned.
6. Reconnect using the device cert (client id = `soundbox-<serial>`), subscribe to
   `devices/soundbox-<serial>/payments` and `.../commands`, and play announcements
   through the speaker/TTS or pre‑recorded amounts.

The AWS reference: *"Fleet Provisioning by Claim"* in the AWS IoT Device SDK for
Embedded C (`fleet_provisioning` demo) — point it at our `template_name` and pass
the serial as the `SerialNumber` parameter.

**Security on device:** store the claim key and (after provisioning) the device key
in the ESP32's encrypted NVS / secure element; enable secure boot + flash
encryption for production units so the keys can't be read off a stolen board.

---

## Then: pair it to a store (remote, no device access)

Once a unit is provisioned it shows up as **unassigned inventory** (`GET /v1/devices`,
status `PROVISIONED`). When a store buys it:

```bash
# add the store with its payment methods
MID=$(curl -s -X POST "${API}v1/merchants" -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"display_name":"Kofi Store","phone":"0244000000","payment_methods":["MTN_MOMO","CARD"]}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["merchant_id"])')

# find the device by serial and assign it
DID=$(curl -s "${API}v1/devices" -H "x-api-key: $KEY" \
  | python3 -c 'import json,sys;print([d["device_id"] for d in json.load(sys.stdin)["devices"] if d["serial_number"]=="SBX-0001"][0])')
curl -s -X POST "${API}v1/devices/${DID}/assign" -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d "{\"merchant_id\":\"$MID\"}"
```

The unit starts announcing that store's payments immediately. Re‑assign or
`unassign` any time from the same endpoints — the device never has to be touched.

Send a test tone to confirm audio before handover:

```bash
curl -s -X POST "${API}v1/devices/${DID}/events" -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"event_type":"TEST_ANNOUNCEMENT"}'
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Provisioning rejected | Serial isn't in the allow‑list → `POST /v1/fleet/serials`. Check the `dev-ghana-fleet-preprovision` log. |
| Connects but silent | Not assigned to a store yet (status `PROVISIONED`), or wrong store — run `assign`. |
| TLS/connect fails | Wrong `iot_endpoint`/region in `claim.json`, or claim cert not `ACTIVE`/policy not attached — re‑run `provision-claim.sh`. |
| "already provisioned" on re‑flash | Expected one‑time guard; a genuine re‑flash of a known unit is allowed and keeps its store binding. |
