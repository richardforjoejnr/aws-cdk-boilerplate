# PoC Decisions (from initial design discussion, 2026-07-11)

Decisions agreed before planning kicked off. These narrow the full concept spec (`../concept.md`) down to a deployable, demoable PoC. Adapted where noted to this repo's AWS serverless stack (the original discussion assumed Docker Compose/Postgres/Mosquitto — we deploy to AWS instead, which also solves the QR reachability problem natively).

## D1 — MTN integration is fully mocked, behind a real adapter interface

- Define a `PaymentProvider` interface: `initiatePayment`, `getStatus`, plus a webhook payload shape mirroring MTN MoMo's Collections callback (concept §17).
- Implement `MockMomoProvider` first. The rest of the system — ledger, webhook receiver, MQTT publish — behaves exactly as production; swapping in the real MTN sandbox adapter later is one module.
- Provider selected by env var: `PAYMENT_PROVIDER=mock | mtn_sandbox`.
- Mock outcomes are **selected by payment amount** (revised 2026-07-11): one magic amount returns FAILED, any other amount succeeds. Two further reserved amounts exercise TIMEOUT (no callback — swept to EXPIRED) and DUPLICATE (callback fired twice — proves idempotency). Always a realistic 2–3 s async delay before the fake callback fires. Amounts are config values; see `architecture.md` §4.3. This doubles as the test matrix (concept §17.8) and gives demo control with zero extra UI.
- **Contract tests run against both adapters** (mock now, MTN sandbox later) so the mock is provably faithful to sandbox behaviour.
- No MTN credentials in the PoC. When the real adapter lands: momodeveloper.mtn.com Collections sandbox; callback URL is already public because we're on API Gateway (no ngrok needed).

## D2 — Mock shape follows MoMo Open API, not the Madapi portal

MTN runs two developer portals:

| Portal | Product | Role for us |
| --- | --- | --- |
| momodeveloper.mtn.com (MoMo Open API) | Collections: Request to Pay + status poll + callback. Free open sandbox. | **The contract the mock mirrors** — matches concept §17 curl scripts and flow. First real adapter. |
| developers.mtn.com (Madapi) | Payments V1 (Ghana), MoMo Withdrawals V1 (disbursements), SMS V2/V3, USSD interface, Notification, Customer KYC Verification, Mobile Customer Information (last SIM-swap date), IoT Device Management. | Candidate **second** adapter (Payments V1) — register and pull its Swagger into `docs/providers/` to diff against the mock contract. SMS/USSD/KYC/SIM-swap APIs bookmarked for post-PoC phases (SIM-swap date maps to the §12.1 fraud control). |

## D3 — QR flow: QR encodes a URL to a hosted mock-wallet portal

There is no real wallet app in the demo, so:

1. **QR generation** — `qrcode` npm package renders `{PUBLIC_BASE_URL}/pay/{qr_id}` as PNG/SVG. `qr_id → merchant` mapping stored in the QR table.
2. **Resolve + portal** — scanning opens the phone browser at `/pay/{qr_id}`; server resolves merchant and serves a mobile-friendly page showing the **merchant name** (the anti-tamper control from §12.1), an amount field, and a Pay button.
3. **Initiation** — Pay POSTs to the payment API, which calls the active provider adapter (mock: 2–3 s delay then fires fake callback).
4. **Live status** — portal polls `/v1/payments/{id}` (or SSE) and flips to "Confirmed ✓" when the ledger updates — the same event that publishes to MQTT.

Reachability: `PUBLIC_BASE_URL` is an env/config value and QRs are regenerated from it. On AWS this is the API Gateway / CloudFront URL — publicly reachable from any phone by default.

## D4 — Soundbox is a browser simulator (no hardware)

- A web page subscribes to `devices/{device_id}/payments` over **MQTT-over-WebSocket** (AWS IoT Core supports this) and uses the **Web Speech API** to announce "Payment received, 20 Ghana cedis."
- A headless Node MQTT subscriber runs alongside for automated tests.
- ESP32 hardware (§17.7) is post-PoC.

## D5 — Demo loop (the PoC acceptance scenario)

> Scan QR → mock wallet portal opens → guest enters GHS 20 → taps Pay → payer's screen shows *pending* → mock provider confirms async → idempotent webhook → ledger records SUCCESS → MQTT publish → browser soundbox **speaks the payment** → payer's screen flips to *Confirmed*.

The pending-vs-soundbox gap is deliberate — it demos the fake-screenshot fraud story: only the soundbox is proof.

## D6 — Phase order

1. Scaffold + infrastructure baseline (CDK stack: API Gateway, DynamoDB, IoT Core, S3 event inbox).
2. Mock provider adapter + payment API + **idempotent webhook receiver** + ledger — fully testable without any UI.
3. QR generation + mock wallet portal page.
4. MQTT publish + browser soundbox simulator.
5. Basic reporting (daily sales / transaction list).

Mock-first matters: the test suite never depends on MTN sandbox availability.

## D7 — Simulated customer wallet (added 2026-07-11)

The mock-wallet portal is backed by a real (simulated-money) wallet service: customers top up a balance, payments debit it, and a payment is **rejected with INSUFFICIENT_FUNDS if the balance is too low**. Debit at initiation; automatic credit-back on FAILED/EXPIRED (demos reversal). Wallets are keyed by phone number entered on the portal — no auth/KYC, it's simulation.

## D8 — Merchant self-service portal (added 2026-07-11)

A second web portal for merchant management: sign up a merchant, list/remove merchants, generate and download the QR code (PNG) for printing/display. Static site on S3/CloudFront calling the Merchant + QR APIs. Stands in for the concept's field-agent app and part of the admin portal.

## D9 — Full layer coverage, PoC-depth (added 2026-07-11)

The PoC implements every concept layer, at demo depth, per the architecture doc:

- **Core services:** merchant, QR, payment orchestration, wallet, device, notification (event-driven stub), settlement (daily aggregation records, reporting-only per concept MVP), reporting.
- **Event layer:** EventBridge bus in the critical path — payment events fan out to device announcement, notification, settlement recording, and audit trail; SQS DLQs for retries.
- **Data layer:** merchant DB, transaction ledger, settlement records, device registry, customer wallets, audit log (DynamoDB) + S3 raw-webhook inbox.
- **Operations layer:** CloudWatch dashboard + alarms, structured logs, audit-log queries, config via SSM parameters.
- **APIs:** concept §8.1 Merchant, §8.2 QR, §8.3 Payment, §8.4 Device — plus a Wallet API (PoC addition).
- **Webhook spec (§9):** implemented for real; it's the *caller* (the provider) that's mocked.
- **Device pairing (§10.2):** the real pairing flow (register → pairing code → bind → test announcement) implemented and exercised by the virtual browser device, designed so a physical ESP32 can use the same APIs later.

## Out of scope for PoC

USSD fallback, real SMS/WhatsApp delivery (notification service publishes events + logs; SNS wiring optional), field-agent mobile app (merchant portal covers onboarding), KYC capture, GhQR format, real payment rails/credentials, money-movement settlement (records only), real device firmware (ESP32 deferred; pairing APIs designed for it).
