# PoC Target Architecture — Ghana Street Vendor Digital Payment & Soundbox Platform

Defines the target architecture, API domains, integration model, data design, security controls, deployment approach, and implementation roadmap for the PoC — every concept layer implemented at demo depth on AWS, designed so the path to the scaled platform (concept.md §5/§14) is an extension, not a rewrite.

Inputs: [`../concept.md`](../concept.md), [`poc-decisions.md`](poc-decisions.md) (D1–D9), [`requirements-review.md`](requirements-review.md), [`vocovo-reuse-review.md`](vocovo-reuse-review.md).

---

## 1. Target Architecture (AWS serverless)

```
                    CUSTOMER PHONE                          MERCHANT LAPTOP/PHONE          DEMO BROWSER TAB
                    scans QR badge                                 |                              |
                          |                                        |                              |
              [Payment Portal  /pay/{qr_id}]           [Merchant Portal /admin]        [Soundbox Simulator /soundbox]
               mobile web, amount + phone,              sign-up, list/remove,           MQTT-over-WSS subscriber,
               live status (poll)                       QR generate/download            Web Speech announcements
                          \_______________________________________|                              |
                                              |                                                   |
                                   [CloudFront + S3 static hosting]                               |
                                              |                                                   |
                                   [Amazon API Gateway (REST)]                          [AWS IoT Core]
                                              |                                          MQTT broker, per-device
        +---------------+---------------+----+-----------+---------------+               topics & policies
        |               |               |                 |               |                       ^
   [Merchant λ]     [QR λ]        [Payment           [Wallet λ]     [Device λ]                   |
    profiles CRUD    generate,     Orchestrator λ]     top-up,        register, pair,             |
        |            resolve       initiate, status,   balance,       heartbeat, cmd              |
        |               |          verify              debit/credit       |                       |
        |               |             |                    |              |                       |
        |               |       [PaymentProvider interface]               |                       |
        |               |        MockMomoProvider | MtnSandboxProvider    |                       |
        |               |             | async callback (2-3s)             |                       |
        |               |             v                                   |                       |
        |               |       [Webhook Receiver λ  /v1/webhooks/{provider}]                     |
        |               |        verify -> S3 inbox -> idempotent ledger write                    |
        |               |             |                                                           |
        +------+--------+------+------+---------------+--------------------+                     |
               |                      v                                                           |
        [DynamoDB tables]      [EventBridge bus: ghana-payments]                                  |
         merchants, wallets,          |  payment.* / device.* events                              |
         qr-codes, payments,          +--> [Device Announcer λ] --- iot:Publish -----------------+
         devices, settlements,        +--> [Notification λ]  (log + optional SNS SMS)
         audit                        +--> [Settlement Recorder λ] (daily aggregates)
               |                      +--> [Audit Writer λ]
        [S3: webhook inbox]           +--> [SQS DLQs on every target]
                                      |
                              [Sweeper λ (EventBridge Schedule, 1 min)]
                               PENDING/INITIATED older than N min -> EXPIRED + wallet credit-back

        OPERATIONS: CloudWatch dashboard + alarms | structured JSON logs | X-Ray tracing
                    SSM Parameter Store (config: magic amounts, timeouts) | audit-log queries via API
                    AWS Budgets alarm (~$20/mo guard — personal account; design-review)
```

Scale path: this is the concept §5 seven-layer architecture with serverless substitutions — API Gateway = gateway layer, Lambdas = core service layer, EventBridge = event layer, DynamoDB/S3 = data layer, CloudWatch = operations layer. At national scale, hot services lift out to containers (concept §14) behind the same API contracts; DynamoDB and IoT Core scale as-is.

## 2. Architecture Decisions (resolves requirements-review blocking questions)

| # | Decision | Rationale |
| --- | --- | --- |
| ADR-1 | **EventBridge is in the critical path.** Webhook Receiver writes the ledger, then publishes `payment.confirmed` etc. to the bus; device announcement, notification, settlement, audit are all bus subscribers. | User requires the event layer (D9). Retries + DLQs per target; adding consumers (reporting, credit signals) needs no producer change. Latency budget (<5 s webhook→announcement) is comfortably met. |
| ADR-2 | **DynamoDB table-per-domain**, not single-table: `merchants`, `wallets`, `qr-codes`, `payments`, `devices`, `settlements`, `audit`. | Domains have disjoint access patterns and may split into services later; mirrors concept §11; PAY_PER_REQUEST makes extra tables free. Repo precedent: Jira dashboard uses per-domain tables. |
| ADR-3 | **Ledger = mutable payment item + append-only event items + S3 raw inbox.** The payment item carries current status (conditional state-machine updates); every transition also appends an immutable `EVT#` item; the raw webhook body lands in S3 before processing (`raw_payload_ref`). | Satisfies both "authoritative record" and "event history" (concept §11) and Appendix B's event-inbox control. |
| ADR-4 | **Two idempotency guards, both as conditional writes.** (a) Ledger: `attribute_not_exists(provider_txn_id)` unique-constraint item — a duplicate callback is acknowledged 200 but writes/publishes nothing. (b) Announce: `attribute_not_exists(announced_at)` conditional update before iot:Publish — the soundbox speaks exactly once. Mock reuses the same `provider_transaction_id` on its DUPLICATE outcome so this is demonstrable. | Requirements-review finding #2/#8. Read-then-write is racy under Lambda concurrency. |
| ADR-5 | **TIMEOUT handled by a sweeper.** The timeout magic amount fires no callback; a 1-minute scheduled Sweeper Lambda expires stale PENDING/INITIATED payments, credits the wallet back, and publishes `payment.expired` (portal shows "Expired — you were not charged"). | Requirements-review finding #4; implements concept §17.8 "callback not received" without provider polling (nothing real to poll). |
| ADR-6 | **Browser soundbox connects directly to IoT Core over MQTT-WSS using a Cognito Identity Pool** (unauthenticated identity, IoT policy scoped to `devices/{device_id}/*` after pairing). Speech unlocked by the pairing user-gesture (entering the pairing code doubles as the required click). **Fallback if the spike exceeds ~1 day:** API Gateway WebSocket bridge (Vocovo portal pattern), keeping the headless MQTT subscriber as the "real device" path. | Requirements-review finding #1 + vocovo-reuse-review §8. Phase 1 spike, before dependent build. |
| ADR-7 | **Mock outcome by amount** (user decision): `FAIL_AMOUNT` (default GHS 13.00) → FAILED callback; `TIMEOUT_AMOUNT` (GHS 9.99) → no callback; `DUPLICATE_AMOUNT` (GHS 2.22) → callback twice; anything else → SUCCESS. Values in SSM config. | Zero demo UI needed to steer outcomes; audience-visible rule. |
| ADR-8 | **Webhook signature verification is OUT of PoC scope** — recorded, not silently dropped. The idempotency unique-constraint (ADR-4) and API Gateway resource policy are the retained controls; the receiver keeps a `verifySignature(provider, req)` seam returning true for `mock`. | Requirements-review finding #3: mock has no secret; MTN Open API callbacks aren't HMAC-signed anyway. |
| ADR-9 | **Wallet debit at initiation, credit-back on FAILED/EXPIRED** via conditional update `balance >= amount` (else the Payment API returns `INSUFFICIENT_FUNDS` and no payment record is created). Amounts stored as **integer pesewas**. | User requirement (D7); atomic check-and-debit avoids negative balances; credit-back demos reversal semantics. |
| ADR-10 | **REST via API Gateway, not AppSync.** | Concept §8 is REST-shaped; portals poll simple endpoints; webhook receiver needs a plain POST. Closes the last planning-README open question. |

## 3. API Domains

All under one API Gateway REST API, stage-prefixed (`{stage}-ghana-payments-api`). Paths follow concept §8 exactly; additions marked **(PoC+)**. Public = no auth (customer-facing); Admin = API-key (merchant portal); Device = called by virtual device / field flow.

### 3.1 Merchant API (concept §8.1) — Admin
- `POST /v1/merchants` — create (name, phone, business_category; KYC fields accepted but stored as-is, no verification)
- `GET /v1/merchants` **(PoC+)** — list, for the merchant portal
- `GET /v1/merchants/{id}` · `PATCH /v1/merchants/{id}` · `PATCH /v1/merchants/{id}/status` (suspend = soft remove)
- `POST /v1/merchants/{id}/wallets` — attach payout wallet record (stored, not used for movement in PoC)

### 3.2 QR API (concept §8.2) — Admin except resolve
- `POST /v1/merchants/{id}/qrs` — generate; returns `qr_id` + QR **PNG (base64)** encoding `{PUBLIC_BASE_URL}/pay/{qr_id}`
- `GET /v1/qrs/{qr_id}` · `POST /v1/qrs/{qr_id}/rotate` · `PATCH /v1/qrs/{qr_id}/status`
- `GET /v1/qrs/{qr_id}/resolve` — **Public**; returns merchant display name + status (the anti-tamper check the portal shows)

### 3.3 Payment API (concept §8.3) — Public (portal-driven)
- `POST /v1/payments` — initiate: `{qr_id, amount, payer_phone}` → wallet debit (ADR-9) → provider adapter → `payment_id`, status INITIATED
- `GET /v1/payments/{id}` — normalized status; portal polls this
- `POST /v1/payments/{id}/verify` — force provider `getStatus` (mock answers from its own state); Admin
- `POST /v1/webhooks/{provider}` — provider callback receiver (§9 flow below)
- Refunds deferred post-PoC (credit-back on failure covers the demo story)

### 3.4 Device API (concept §8.4) — Admin except pair/heartbeat
- `POST /v1/devices` — register (serial, model) → status UNASSIGNED
- `POST /v1/devices/{id}/pair` — **the real §10.2 flow**: admin requests pairing → short-lived pairing code; the device (virtual or physical) submits `{serial, pairing_code}` → binds device↔merchant, issues its scoped MQTT credentials/identity → status PAIRED; first test announcement flips it ACTIVE
- `POST /v1/devices/{id}/events` — command (test announcement, volume) via `devices/{id}/commands`
- `POST /v1/devices/{id}/heartbeat` · `PATCH /v1/devices/{id}/status`
- Presence: IoT lifecycle events flip ACTIVE/OFFLINE automatically (no polling)

### 3.5 Wallet API **(PoC+)** — Public (simulation)
- `POST /v1/wallets/{phone}/topup` — add simulated funds
- `GET /v1/wallets/{phone}` — balance
- Debit/credit are internal (Payment Orchestrator only), never exposed

## 4. Integration Model

### 4.1 Provider adapter seam
```ts
interface PaymentProvider {
  initiatePayment(req: InitiatePaymentRequest): Promise<{ providerRef: string }>;
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>;
}
```
`PAYMENT_PROVIDER=mock | mtn_sandbox` selects the implementation. `MockMomoProvider`'s callback body mirrors the MTN MoMo Collections callback shape (concept §17), so `MtnSandboxProvider` is a drop-in with the same webhook route. Contract tests run against both (D1).

### 4.2 Webhook flow (§9 — implemented for real; the *caller* is mocked)
1. `POST /v1/webhooks/mock` receives the callback.
2. Raw body → S3 inbox (`webhooks/{provider}/{yyyy}/{mm}/{dd}/{event_id}.json`) — durable before any processing (Appendix B).
3. Signature seam (ADR-8), then normalize to the internal `PaymentEvent` schema (`src/shared/types.ts`).
4. Idempotent ledger write (ADR-4a); duplicates → 200, stop.
5. Publish `payment.confirmed | payment.failed` to EventBridge; return 200 only after steps 2–5 (retry-safe).

### 4.3 Mock provider behaviour (ADR-7)
`initiatePayment` records the request and enqueues its callback to an SQS queue with `DelaySeconds` 2–3 s; a delivery Lambda then **POSTs over HTTPS to the real public webhook URL** — exercising API Gateway and the receiver exactly as an external provider would (design-review F-2; DLQ on the queue). Outcome by amount: `FAIL_AMOUNT`→FAILED, `TIMEOUT_AMOUNT`→silence (sweeper expires), `DUPLICATE_AMOUNT`→callback ×2 with the same `provider_transaction_id`, else SUCCESS. FAILED/EXPIRED trigger wallet credit-back (ADR-9), driven by the corresponding bus events.

**State machine rule (design-review F-1):** SUCCESS, FAILED, and EXPIRED are terminal; the ledger's conditional update rejects any transition out of them. A late callback for an expired payment is recorded as an `ANOMALY_LATE_CALLBACK` event item and publishes nothing — no announcement, no wallet movement.

### 4.4 Virtual soundbox — simulating the ESP32 (§17.7)

A third portal page, `/soundbox`, is the device simulator. It mirrors the ESP32 firmware's behaviour (concept §17.7) exactly, but in a browser:

| ESP32 firmware behaviour | Browser simulator equivalent |
| --- | --- |
| Connects to broker over MQTT/TLS (`PubSubClient`) | Connects to AWS IoT Core over MQTT-WSS (`mqtt.js`), Cognito identity (ADR-6) |
| Subscribes `devices/{CLIENT_ID}/payments` (QoS 1) | Same topic, same QoS, persistent session for offline catch-up |
| `ANNOUNCE_PAYMENT` → plays audio / TTS | Web Speech API speaks "Payment received, 20 Ghana cedis" (+ on-screen flash + payment log list) |
| Publishes `{"status":"played"}` ack to heartbeat topic | Same publish — this is what lets automated tests assert announcement delivery |
| 60 s heartbeat `{"status":"online"}` | Same interval publish; battery/signal fields faked for realism |
| Hardcoded `CLIENT_ID`, pre-provisioned credentials | **Pairing screen**: enter device serial + pairing code from the merchant portal (§3.4 real §10.2 flow) → receives its device_id + scoped credentials; the required click also unlocks Web Speech autoplay |
| `commands` topic: test announcement, volume | Handles `devices/{id}/commands` — volume slider + test-announcement button reflect commands |

Because the simulator drives the **same Device API pairing flow and the same topics** a physical device would, swapping in a real ESP32 later is a firmware task only — no backend change ("support actual implementation" requirement). A headless Node MQTT subscriber (`src/devices/sim/`) implements the same contract for CI, so the demo page and the test path can't drift apart.

**Device-side dedupe (design-review F-3):** QoS 1 permits broker redelivery, so the device contract (sim, headless subscriber, future firmware) dedupes announcements by `payment_id` (short LRU) — "speaks exactly once" holds end to end. Offline-recovery/persistent-session testing belongs to the headless subscriber; a browser reload creates a fresh identity and session (design-review F-6).

Demo tip: open `/soundbox` on a laptop with speakers, pair it to the demo merchant, then have the audience scan the QR with their phones — each success is announced aloud within ~5 s.

### 4.5 Event layer
Single bus `{stage}-ghana-payments`. Detail types: `payment.initiated|confirmed|failed|expired`, `device.paired|online|offline`, `wallet.debited|credited`. Rules → Lambda targets (§1 diagram); every target has an SQS DLQ + alarm; audit writer subscribes to `*`.

## 5. Data Design (DynamoDB, per ADR-2/3; all money in integer pesewas)

| Table | Keys | Items / notes |
| --- | --- | --- |
| `{stage}-ghana-merchants` | pk `merchant_id` | profile, status (PENDING_KYC→ACTIVE...), payout-wallet records as `WALLET#` items (sk) |
| `{stage}-ghana-wallets` | pk `phone` | customer sim wallet: `balance_pesewas`, `updated_at`; conditional debit `balance >= :amt` |
| `{stage}-ghana-qr-codes` | pk `qr_id`; GSI1 `merchant_id` | qr_type, payload URL, status; resolve is a point read |
| `{stage}-ghana-payments` | pk `payment_id`, sk `META` \| `EVT#{ts}#{event_id}` \| `IDEMPOTENCY#{provider_txn_id}`; GSI1 `merchant_id`+`confirmed_at` (reporting); GSI2 `status`+`created_at` (sweeper) | META = mutable authoritative record; EVT items = append-only history; IDEMPOTENCY item = unique-constraint guard (ADR-4a); `announced_at` guard on META (ADR-4b) |
| `{stage}-ghana-devices` | pk `device_id`; GSI1 `merchant_id` | registry + pairing as attributes/items: serial, status, paired merchant, `pairing_code` (TTL attr), `last_seen_at` |
| `{stage}-ghana-settlements` | pk `merchant_id`, sk `date` | daily aggregates written by Settlement Recorder: gross, count, fees=0, status OPEN→RECONCILED (records only, no money movement) |
| `{stage}-ghana-audit` | pk `date`, sk `ts#event_id` (TTL 90d) | every bus event + admin API mutation |

S3: `{stage}-ghana-webhook-inbox` (raw callbacks, lifecycle→expire 30d in dev).

## 6. Security Controls (PoC baseline → production path)

| Control | PoC | Production path |
| --- | --- | --- |
| Admin APIs (merchant/QR/device mgmt) | API Gateway API key + usage plan | Cognito user pool + RBAC roles (concept §12) |
| Public endpoints (`/pay` resolve, payments, wallet) | Open by design (customer flow); throttling via usage plan; no PII beyond phone | GhQR/wallet-app auth, fraud rules |
| Webhook endpoint | Idempotency unique-constraint + raw inbox + throttle; signature seam stubbed (ADR-8) | HMAC/provider signature verification, replay window |
| Device/MQTT | Per-device identity, IoT policy scoped to own `devices/{id}/*` topics (never a shared topic — see vocovo-reuse-review); pairing code short-TTL, single-use | X.509 per device, cert rotation, lost-device revocation |
| Data | Sensitive fields (phone, ghana_card) hashed/tokenized before storage; never logged in plaintext; SSE on DynamoDB/S3; secrets in SSM/Secrets Manager, none in code | KMS CMKs, field-level tokenization service |
| Audit | All bus events + admin mutations to audit table | Immutable export, SIEM |
| IAM | One least-privilege role per Lambda (own table/topic only) | unchanged |

## 7. Deployment Approach

- **CDK stack:** `GhanaPaymentsStack` (`packages/infrastructure/lib/ghana-payments/`), following the `JiraDashboardStack` precedent; deployed per stage (`{stage}-aws-boilerplate-ghana-payments`), dev uses PAY_PER_REQUEST + DESTROY policy per repo conventions. Dedicated npm scripts `ghana:deploy:{stage}` / `ghana:destroy:{stage}` mirroring the Jira pair.
- **Static portals:** payment portal, merchant portal, soundbox sim built from `packages/ghana-payments` web assets to S3+CloudFront (same pattern as `WebAppStack`). **One public domain (design-review F-4):** the same CloudFront distribution routes `/api/*` to API Gateway — zero CORS, one URL, edge caching/WAF-lite in front of the API. `PUBLIC_BASE_URL` = the CloudFront URL, injected into QR generation config — publicly scannable by any phone with zero tunnelling; QR URLs stay stable across redeploys.
- **Config:** SSM parameters (`/{stage}/ghana-payments/…`) for magic amounts, sweeper timeout, provider selection.
- **Environments:** dev only for the PoC; PR-preview compatible since everything is stage-prefixed.
- **CI:** existing `ci.yml` covers the workspace (build/lint/test); deploys stay manual via the deploy scripts.

## 8. Implementation Roadmap (supersedes D6 phase list)

| Phase | Scope | Exit criterion |
| --- | --- | --- |
| **0. Spike** | Browser → IoT Core MQTT-WSS via Cognito + Web Speech behind a user gesture (ADR-6). Throwaway page. Must cover the three sharp edges in design-review F-6: per-identity `iot:AttachPolicy`, clientId policy pattern, reload/session behaviour. | A browser tab speaks a hand-published MQTT message, or fallback decision taken. |
| **1. Foundation** | CDK stack: tables, bus, S3 inbox, API skeleton, SSM config, dashboard shell. Merchant API + Wallet API + tests. | Deployed to dev; create merchant + top-up wallet via curl. |
| **2. Payment core** | Provider interface + MockMomoProvider, Payment API, wallet debit/credit-back, Webhook Receiver (inbox → idempotent ledger → bus), Sweeper, audit writer. Contract + idempotency tests (all four amounts). | End-to-end via curl: initiate → callback → ledger SUCCESS; duplicate is a no-op; timeout expires + refunds. |
| **3. QR + portals** | QR API + PNG generation; payment portal (`/pay/{qr_id}`: merchant name, amount, phone, live status incl. FAILED/EXPIRED/INSUFFICIENT_FUNDS states); merchant portal (sign-up, list/remove, QR download). | Phone scans a printed QR and completes a payment against dev. |
| **4. Device + soundbox** | Device API, real §10.2 pairing flow, Device Announcer λ, announce-idempotency, browser soundbox sim + headless test subscriber, IoT lifecycle→status. | Full D5 demo loop: scan → pay → soundbox speaks once → portal confirms. |
| **5. Settlement, reporting, ops** | Settlement Recorder (daily aggregates), reporting endpoints (daily sales, transaction list, reconciliation export), notification λ (log/SNS-stub), CloudWatch dashboard + DLQ alarms, demo runbook. | Merchant portal shows daily totals; dashboard green; scripted demo executes clean. |

Post-PoC backlog: MTN sandbox adapter (contract tests already green), signature verification, Cognito RBAC, GhQR payload format, refunds API, ESP32 firmware, SMS/WhatsApp delivery, USSD.
