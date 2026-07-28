# Soundbox Fleet Provisioning & Remote Store Pairing

How soundboxes are provisioned at scale and paired to stores remotely — the
"pre‑configured card" model: build a unit once, hold it as inventory, and when a
store pays, run one flow to add the store, choose its payment methods, and point a
device at it. The store just plugs it in.

## The two independent lifecycles

The core idea is that **device identity** and **merchant binding** are decoupled.

```
PROVISIONING (once, at manufacture)          PAIRING (any time, remote)
  claim cert ──► unique device cert            POST /v1/devices/{id}/assign
  Thing soundbox-<serial>                        sets merchant_id (one DB write)
  status: MANUFACTURED ─► PROVISIONED            status: PROVISIONED ─► ACTIVE
```

Announce routing is already `merchant → device` (`src/devices/announcer.ts` looks
up the store's device on `payment.confirmed`), so binding a device to a store is a
single `UpdateItem` — instant, remote, and re‑assignable. A device is inert until
assigned (bound to no store, reachable only on its own topics), so a unit in
transit is useless if lost or stolen.

## Provisioning by claim (AWS IoT Fleet Provisioning)

Every unit ships with the **same** low‑privilege claim certificate baked into
firmware. On first boot it self‑provisions:

1. Connect with the **claim cert**.
2. `$aws/certificates/create/json` → IoT mints the device its **own** unique cert.
3. `$aws/provisioning-templates/<template>/provision/json` with `{SerialNumber}`.
4. The **pre‑provisioning hook** (`src/fleet/pre-provisioning-hook.ts`) validates
   the serial against the manufactured allow‑list and one‑time use, then approves.
5. IoT registers `Thing soundbox-<serial>`, activates the cert, and attaches the
   single **parameterised device policy** (`devices/${iot:Connection.Thing.ThingName}/*`).
6. The device reconnects with its own cert and never uses the claim cert again.

### Why a shared claim cert is safe

| Threat | Mitigation |
|--------|-----------|
| Claim cert leaks | Claim policy allows **only** provisioning topics — it cannot read payments or publish as a device. Rotate it; provisioned devices are unaffected. |
| Minting arbitrary identities | Pre‑provisioning hook refuses any serial **not** in the manufactured allow‑list, and refuses re‑use except a known device re‑provisioning. |
| Per‑device policy sprawl | One parameterised policy scopes every device to its own `Thing` topics via policy variables — no per‑device policies. |

## Infrastructure (`lib/fleet-provisioning-stack.ts`)

- **Device policy** — `${stage}-ghana-soundbox-device`, thing‑scoped, attached to
  each device cert by the template.
- **Claim policy** — `${stage}-ghana-soundbox-claim`, provisioning topics only.
- **Provisioning template** — `${stage}-ghana-soundbox`; creates the Thing +
  activates the cert; wired to the pre‑provisioning hook.
- **Pre‑provisioning hook Lambda** — the allow‑list security gate.
- **Provisioning role** — what IoT assumes to register things/certs.

## API

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /v1/fleet/serials` | admin | Record manufactured serials into the allow‑list (`{ "serials": ["SBX-001", …] }`). |
| `POST /v1/devices/{id}/assign` | admin | Pair a provisioned device to a store (`{ "merchant_id": "mer_…" }`). |
| `POST /v1/devices/{id}/unassign` | admin | Return a device to unassigned inventory. |
| `POST /v1/merchants` | admin | Now accepts `payment_methods` (subset of `MTN_MOMO`, `VODAFONE_CASH`, `AIRTELTIGO`, `CARD`). |

Device lifecycle: `MANUFACTURED → PROVISIONED → ACTIVE` (+ `SUSPENDED`/`RETIRED`).

## Onboarding a store (operator flow)

1. **Add store** — `POST /v1/merchants { display_name, phone, payment_methods }`.
2. **Assign a device** — pick an unassigned unit → `POST /v1/devices/{id}/assign`.
3. Done — the device announces that store's payments immediately.

## Test it out — no hardware needed (virtual device)

The simulator (`device-client/fleet-provision.mjs`) runs the **exact** claim
provisioning flow a real unit runs, on your laptop.

```bash
# 0. deploy (fleet stack included) and grab the API + admin key
cd apps/ghana-payments && STAGE=dev ./scripts/deploy.sh dev
API=$(aws cloudformation describe-stacks --stack-name dev-ghana-payments-api \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
KEY=$(aws apigateway get-api-key --api-key \
  "$(aws cloudformation describe-stacks --stack-name dev-ghana-payments-api \
     --query "Stacks[0].Outputs[?OutputKey=='AdminApiKeyId'].OutputValue" --output text)" \
  --include-value --query value --output text)

# 1. mint the claim bundle (what firmware would carry)
./scripts/provision-claim.sh dev

# 2. record a manufactured serial (the factory step)
curl -s -X POST "${API}v1/fleet/serials" -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"serials":["SBX-DEMO-1"]}'

# 3. provision + go live (claim ─► own cert ─► listen). Leave it running.
node device-client/fleet-provision.mjs claim-bundle SBX-DEMO-1

# 4. onboard a store and assign the device (another terminal)
MID=$(curl -s -X POST "${API}v1/merchants" -H "x-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"display_name":"Ama Fruits","phone":"0200000000","payment_methods":["MTN_MOMO"]}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["merchant_id"])')
DID=$(curl -s "${API}v1/devices" -H "x-api-key: $KEY" \
  | python3 -c 'import json,sys;print([d["device_id"] for d in json.load(sys.stdin)["devices"] if d["serial_number"]=="SBX-DEMO-1"][0])')
curl -s -X POST "${API}v1/devices/${DID}/assign" -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d "{\"merchant_id\":\"$MID\"}"

# 5. take a payment → the simulator announces it
curl -s -X POST "${API}v1/wallets/0244000111/topup" -H 'content-type: application/json' -d '{"amount_pesewas":50000}'
curl -s -X POST "${API}v1/payments" -H 'content-type: application/json' \
  -d "{\"merchant_id\":\"$MID\",\"amount_pesewas\":12000,\"payer_phone\":\"0244000111\"}"
# ► the fleet-provision terminal prints/speaks: "Payment received, 120.00 Ghana cedis"
```

## Test it out — real device

Same flow, on hardware. See **`docs/SOUNDBOX_SETUP.md`** to get a physical unit
ready (flash the claim bundle + config). A Raspberry Pi can run
`fleet-provision.mjs` verbatim; an ESP32 runs the equivalent C bootstrap. Then run
steps 2, 4, 5 above against the real unit's serial.

## Tests

- `src/fleet/pre-provisioning-hook.test.ts` — allow‑list gate, unknown/retired
  serial refusal, one‑time/race guards, re‑provision‑keeps‑store.
- `src/devices/fleet.test.ts` — manufacture, assign (provisioned→ACTIVE, 409 when
  not assignable, merchant‑must‑be‑ACTIVE), unassign.
- `src/merchants/handlers.test.ts` — payment‑method validation, defaults, PII not
  leaked.
