# Code Tour — how the Ghana Payments PoC works and what's where

A guided map of the code. For *operating* the system see [`RUNBOOK.md`](RUNBOOK.md); for *why* it's designed this way see [`planning/architecture.md`](planning/architecture.md) (ADR-1..10). This doc is about the code itself.

## 1. Where everything lives

```
packages/ghana-payments/            ← this package: all application code
├── src/                            ← Lambda handlers + domain logic (TypeScript, ESM)
├── web/                            ← the three portals (plain HTML/CSS/JS, no framework)
├── device-client/                  ← Node client for REAL soundboxes (laptop/Pi)
├── spike/                          ← Phase 0 throwaway (browser→IoT proof) — superseded
├── docs/                           ← concept spec, runbooks, planning docs (you are here)
├── jest.config.cjs                 ← unit tests (`npm test` in this package)
└── tsconfig.json / tsconfig.build.json  ← build excludes *.test.ts; lint includes them

packages/infrastructure/lib/ghana-payments/   ← CDK stacks (what gets deployed)
├── foundation-stack.ts             ← data + event layer (tables, bus, S3 inbox, SSM)
├── api-stack.ts                    ← every Lambda, the REST API, queues, rules, IoT glue
├── web-stack.ts                    ← CloudFront + S3 portals + /api/* routing
└── spike-stack.ts                  ← throwaway, gated behind DEPLOY_GHANA_SPIKE=true
    (wired together in packages/infrastructure/bin/app.ts, "Ghana Payments" section)

scripts/deploy-ghana-payments.sh    ← deploy all stacks + print/export URLs
scripts/destroy-ghana-payments.sh   ← destroy + clean IoT policies/SSM + verify zero
scripts/setup-real-device.sh        ← provision an X.509 cert bundle for real hardware

.github/workflows/ghana-payments-deploy.yml       ← manual deploy (any stage)
.github/workflows/ghana-payments-destroy.yml      ← manual destroy (type DESTROY)
.github/workflows/ghana-payments-pr-preview.yml   ← per-PR env + comment + auto-destroy

.claude/agents/ghana-*.md           ← project agents (architect, reviewer, tester,
                                      devops, verifier) for Claude Code sessions
```

**One rule that explains the layout:** `src/` is organised by *domain* (merchants, qr, wallets, payments, devices…) so any domain could be split into its own service later without unpicking a shared blob.

## 2. The three stacks (deploy order)

| Stack | Contents | Why separate |
| --- | --- | --- |
| `{stage}-ghana-payments-foundation` | 7 DynamoDB tables, EventBridge bus, S3 webhook-inbox bucket, SSM config params | Data outlives compute; changes rarely |
| `{stage}-ghana-payments-api` | All ~20 Lambdas, API Gateway REST API + API key, SQS mock-callback queue + DLQs, EventBridge rules, sweeper schedule, Cognito identity pool + IoT heartbeat rule | The moving parts; redeployed constantly |
| `{stage}-ghana-payments-web` | S3 bucket with `web/`, CloudFront distribution (portals + `/api/*` → API Gateway), writes `public-base-url` to SSM | Gives ONE public HTTPS domain — no CORS, and QR codes are scannable from any phone |

Every resource is stage-prefixed (`dev-ghana-*`, `pr-15-ghana-*`), so environments coexist in one account. No stage retains data — destroy always reaches zero.

## 3. `src/` module by module

### `shared/` — used by everything
- **`types.ts`** — the domain vocabulary: status enums (payment INITIATED→PENDING→SUCCESS/FAILED/EXPIRED…, device UNASSIGNED→PAIRED→ACTIVE…), the internal `PaymentEvent` schema, the `DeviceAnnouncement` payload. Comes straight from the concept spec §9/§20.
- **`clients.ts`** — singleton DynamoDB DocumentClient + `publishEvent()` (EventBridge, source `ghana.payments`).
- **`config.ts`** — reads `/{stage}/ghana-payments/*` from SSM (magic amounts, sweeper expiry, `public-base-url`), cached 60 s per Lambda container.
- **`http.ts`** — API Gateway response helpers + the Appendix-A error model; `requirePesewas()` enforces the money-is-integer-pesewas rule.
- **`pii.ts`** — `hashPii()`: phone numbers / Ghana Card are stored and logged only as salted SHA-256 hashes.
- **`iot.ts`** — `publishToDevice(topic, payload)`: QoS-1 MQTT publish via the IoT data plane (endpoint discovered once and cached).

### `merchants/handlers.ts`
Plain CRUD: create (activates immediately — no KYC in PoC), list (scan; fine at PoC scale), get (strips PII hashes from responses), status PATCH (suspend = soft remove).

### `qr/handlers.ts`
Generates a `qr_id`, stores it with a payload URL of `{public-base-url}/pay/{qr_id}`, and renders the PNG with the `qrcode` package. `resolve` is the only public route: given a scanned `qr_id` it returns the merchant's display name — the anti-tamper check the pay page shows — and 410s for rotated/compromised QRs or suspended merchants. `rotate` retires a badge and issues a replacement.

### `wallets/` — the simulated customer wallet
- **`store.ts`** — the important function is `debit()`: a single conditional update `ADD balance -amount IF balance >= amount`. Atomic check-and-debit; a race can never overdraw. `credit()` is the refund path.
- **`handlers.ts`** — public top-up and balance endpoints (wallets are keyed by `hashPii(phone)`).

### `payments/` — the core
- **`provider.ts`** — the seam that makes the whole PoC honest: a `PaymentProviderAdapter` interface (`initiatePayment`, `getStatus`). The rest of the system only sees this interface; swapping the mock for real MTN MoMo is one new class.
- **`mock-provider.ts`** — the mock implementation. Outcome decided by amount (from SSM): 1300 pesewas → FAILED callback, 999 → *no* callback (timeout), 222 → the same callback delivered twice, else SUCCESS. It doesn't call anything directly — it enqueues the callback to SQS with a 3 s delay.
- **`mock-delivery.ts`** — SQS consumer that POSTs the callback **over HTTPS to the real public webhook URL**, so the mock traverses API Gateway exactly as MTN would. Failures retry then DLQ.
- **`initiate.ts`** — `POST /v1/payments`: check merchant is ACTIVE → atomic wallet debit (402 if short — no payment record is even created) → write ledger INITIATED → call the provider → publish `payment.initiated`. If the provider call throws after the debit, the money is credited straight back.
- **`ledger.ts`** — the heart. The payments table holds three item kinds under one `payment_id`:
  - `META` — the mutable authoritative record (status, amounts, `announced_at`…)
  - `EVT#{ts}` — append-only history (every transition, plus anomalies)
  - `IDEM#{provider_txn_id}` — the idempotency unique-constraint item
  `confirmPayment()` does one DynamoDB transaction: put the IDEM item (fails if it exists → duplicate) + update META conditioned on status still being open (fails if terminal → late callback, recorded as `ANOMALY_LATE_CALLBACK`, publishes nothing). SUCCESS/FAILED/EXPIRED are absorbing states. `markAnnounced()` / `markCreditedBack()` are the exactly-once guards for the soundbox and refunds.
- **`webhook.ts`** — `POST /v1/webhooks/{provider}`: raw body to the S3 inbox *first* (audit before interpretation), normalize to the internal `PaymentEvent`, run `confirmPayment()`, and only on a fresh transition publish `payment.confirmed|failed` to the bus. Replays and duplicates get a 200 with no side effects — provider retries are always safe.
- **`sweeper.ts`** — every minute, queries open payments older than the expiry window (GSI2 on status+created_at) and expires them with the same race-safe conditional; publishes `payment.expired` (which triggers the refund). This is what resolves the "provider never called back" case.
- **`get.ts`** — the status endpoint the pay page polls.

### `events/` — bus subscribers
- **`credit-back.ts`** — on `payment.failed|expired`: take the `credited_back_at` guard, then credit the wallet. Exactly-once even if EventBridge redelivers.
- **`audit-writer.ts`** — subscribes to *every* `ghana.payments` event and writes it to the audit table (90-day TTL).

### `devices/` — soundboxes
- **`handlers.ts`** — register (with `device_type` REAL|VIRTUAL), list, pairing-code (admin: 6-digit, 10-min, stored as a plain attribute — deliberately **not** a DynamoDB TTL, which would delete the whole item), and the public **pair** endpoint: validates serial+code, binds the merchant, then creates a per-device IoT policy (topics `devices/{device_id}/*` only) and attaches it to the caller's Cognito identity (browser) **or** X.509 certificate ARN (real hardware). `deleteHandler` reverses all of it. `configHandler` gives the soundbox page its bootstrap (identity pool, IoT endpoint).
- **`announcer.ts`** — the demo's climax: on `payment.confirmed`, find the merchant's PAIRED/ACTIVE device, take the announce-once guard, publish the `ANNOUNCE_PAYMENT` message to that device's topic.
- **`status-updater.ts`** — target of an IoT topic rule on `devices/+/heartbeat`: flips PAIRED→ACTIVE and stamps `last_seen_at`.

### `auth/`, `costs/`, `issues/`
- **`auth/handlers.ts`** — portal sign-in: username/password checked (constant-time) against a hash in SSM SecureString, returns the admin API key (looked up *by name* at runtime — an env ref to the key id creates a CloudFormation cycle; the comment in `api-stack.ts` explains).
- **`costs/handlers.ts`** — account month-to-date + yesterday from Cost Explorer, cached 6 h in SSM because each CE call bills $0.01. Feeds the admin footer.
- **`issues/handlers.ts`** — "Report an issue" → GitHub Issues, token from SSM SecureString, admin-key gated.

## 4. `web/` — the portals

Plain static pages sharing `styles.css` (design tokens in `planning/ui-style.md`). They call the API with **relative** `/api/v1/...` paths — same CloudFront domain, so no CORS anywhere.

- **`pay/index.html`** — what a scanned QR opens. Resolves the QR → shows the merchant name → amount + phone (remembered in localStorage; balance shown live; inline top-up) → POST payment → polls status → SUCCESS/FAILED/EXPIRED states with the refreshed wallet balance.
- **`admin/index.html`** — sign-in → merchants (create/QR PNG/suspend), devices (register with type+merchant, pairing codes with lifecycle chips, Test/Info/Remove), cost footer, report-an-issue. Auto-refreshes devices every 15 s.
- **`soundbox/index.html`** — the virtual device. Pairs with serial+code (the click also unlocks browser audio), gets a Cognito identity, SigV4-signs an MQTT-over-WebSocket URL (Web Crypto — no SDK), subscribes to its own topics, **speaks** announcements (Web Speech), dedupes by `payment_id`, heartbeats every 60 s, handles TEST_ANNOUNCEMENT / SET_VOLUME / DEVICE_REMOVED commands, and reconnects without a code on the browser that paired it.
- **`soundbox/mqtt.min.js`** — vendored MQTT client. Committed deliberately: the root `.gitignore` ignores `*.js`, with a negation rule for `packages/ghana-payments/web/**` (this file being silently ignored once broke pipeline deploys).

## 5. Life of a payment (follow a GHS 20 scan end-to-end)

1. Phone scans the badge → opens `/pay/qr_x` → `qr/handlers.resolveHandler` returns "Kofi Mensah Electronics".
2. Pay tapped → `payments/initiate.ts`: wallet debited atomically, ledger META written (INITIATED), `mock-provider.ts` queues the callback in SQS (delay 3 s).
3. SQS fires `mock-delivery.ts` → HTTPS POST to `/v1/webhooks/mock` through CloudFront + API Gateway.
4. `webhook.ts`: raw JSON → S3 inbox; `ledger.confirmPayment()` transaction flips META to SUCCESS + writes EVT + IDEM items; publishes `payment.confirmed`.
5. EventBridge fans out: `audit-writer` records it; `announcer.ts` finds the device, takes `announced_at`, publishes to `devices/dev_y/payments`.
6. The soundbox page receives it over MQTT-WSS and speaks *"Payment received, 20 Ghana cedis"*; publishes a `played` heartbeat.
7. The pay page's next poll sees SUCCESS and flips to ✓ with the new balance.

Failure variants: amount 1300 → step 4 records FAILED → `credit-back.ts` refunds; amount 999 → step 3 never happens, `sweeper.ts` expires it within ~6 min → refund; amount 222 → step 3 happens twice, the IDEM item makes the second a no-op → exactly one announcement.

## 6. Data model at a glance (DynamoDB, on-demand)

| Table | Key(s) | Holds |
| --- | --- | --- |
| `ghana-merchants` | `merchant_id` + `sk` | `PROFILE` item (+ future `WALLET#` payout items) |
| `ghana-wallets` | `phone` (hashed) | `balance_pesewas` |
| `ghana-qr-codes` | `qr_id` (GSI1: merchant) | payload URL, status |
| `ghana-payments` | `payment_id` + `sk` | `META` / `EVT#…` / `IDEM#…` (GSI1 merchant+date, GSI2 status+created for the sweeper) |
| `ghana-devices` | `device_id` (GSI1 merchant, GSI2 serial) | registry, pairing state, last_seen |
| `ghana-settlements` | `merchant_id` + `date` | daily aggregates (Phase 5) |
| `ghana-audit` | `date` + `ts#id` (TTL 90d) | every bus event |

Money is always **integer pesewas**. Anything sensitive is stored via `hashPii()`.

## 7. Tests & verification

- **Unit tests** (`src/**/*.test.ts`, `aws-sdk-client-mock`): the invariants — `confirmPayment`'s three outcomes, sweeper race, exactly-once credit-back, atomic debit, all four mock amounts, QR anti-tamper (410s). `npm test --workspace=@aws-boilerplate/ghana-payments`.
- **Live verification**: the `ghana-verifier` Claude agent (`.claude/agents/ghana-verifier.md`) climbs build → tests → synth → driving the deployed dev stack end-to-end, including webhook replay.
- **Headless device**: `device-client/soundbox-client.mjs` doubles as the automated soundbox for cert-auth testing.

## 8. Where to change common things

| Want to… | Touch |
| --- | --- |
| Change magic amounts / sweeper timing | SSM params (live, no deploy — RUNBOOK §5) or defaults in `foundation-stack.ts` |
| Add an API endpoint | handler in `src/{domain}/`, then Lambda + route in `api-stack.ts` (use the `make()` helper; grant least-privilege per table) |
| Add a real payment provider | new class implementing `PaymentProviderAdapter` in `src/payments/`, register it in `provider.ts`, set SSM `provider/active` |
| Change portal look | `web/styles.css` (tokens at top) — redeploy web stack only |
| Add a bus consumer | Lambda in `src/events/` + rule with DLQ in `api-stack.ts` |
| New device command | publish shape in `devices/handlers.commandHandler`, handle in `web/soundbox/index.html` + `device-client/` |
