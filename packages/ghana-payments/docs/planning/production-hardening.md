# Production Hardening — Ghana Payments

How to take the PoC (see `architecture.md`, ADR-1..10) to a production system that **scales**, is **secure enough to sit in front of real payment rails**, and performs acceptably on **Ghana's expensive, patchy mobile networks** — plus a concrete way to **measure end-to-end latency during a real Ghana field test**.

The PoC is already the right shape: serverless (Lambda + API Gateway + DynamoDB + EventBridge + IoT Core), idempotent, event-driven, provider-abstracted. Nothing here is a rewrite — it's hardening, real integrations, and network/economics tuning.

---

## 1. Security to integrate with payment systems

The platform is an **orchestration + merchant-experience layer**, not a card processor — it never touches card PANs, so PCI-DSS scope is minimal. But it initiates real money movement, holds sensitive PII (MSISDN, Ghana Card), and stores provider credentials, so it must be hardened to a payments-grade bar.

### 1.1 Regulatory / compliance framing (decide early)
- **Bank of Ghana / GhIPSS**: operating a payment orchestration/merchant-aggregation service in Ghana may require a PSP/PSSP licence or partnering with a licensed aggregator. Confirm before go-live (concept §21 open decision).
- **Ghana Data Protection Act (2012)**: register with the Data Protection Commission; lawful basis, retention limits, data-subject rights. Drives the tokenisation and retention rules below.
- **MTN MoMo commercial onboarding**: production credentials, KYC, IP/domain allow-listing, callback host registration (concept §17.2, Appendix C).
- **PCI-DSS**: only relevant if card rails are ever added; keep the design so the platform never receives PANs (tokenised/hosted fields) to stay out of scope.

### 1.2 The gaps between PoC and payments-grade (each is a work item)

| Area | PoC state | Production requirement |
| --- | --- | --- |
| **Webhook signature verification** | Stubbed (ADR-8) — idempotency only | **Real HMAC/provider-signature verification** on every callback (concept Appendix B). MTN Open API isn't HMAC-signed, so enforce: callback host allow-list + mutual TLS or a shared secret in a signed header + IP allow-listing + the existing idempotency unique-constraint. Reject anything unverified. |
| **Secrets** | SSM SecureString, static GitHub token, admin creds | **AWS Secrets Manager (or KMS-backed) with rotation**; MTN API user/key/subscription key rotated on a schedule; no long-lived tokens; per-environment isolation; never in code or logs. Consider an HSM/KMS CMK for signing. |
| **AuthN/AuthZ** | API-key admin, public portals | **Cognito user pool + OIDC + RBAC** (Admin/Support/Finance/Agent/Read-only per concept §12); MFA for Finance/Admin; short-lived tokens; the public `/pay` portal stays unauthenticated by design but rate-limited and bot-protected. |
| **Idempotency & ledger** | Built (ADR-4) | Keep — it's already payments-grade. Add **daily reconciliation** against MTN transaction reports (concept §13), a dispute/exception queue, and immutable audit export to a WORM store. |
| **PII protection** | `hashPii()` (SHA-256) | **Tokenise** MSISDN/Ghana Card via a dedicated tokenisation service or KMS-encrypted deterministic tokens; **encrypt at rest with a customer-managed KMS key**; field-level access controls; never log plaintext (already enforced). |
| **Fraud controls** | Amount-based mock only | Implement concept §12.1: duplicate-payment and velocity checks (already have the event stream), mismatched-merchant-name detection, refund-abuse RBAC + approval workflow, and **SIM-swap detection via MTN's "Mobile Customer Information" API** (last SIM-swap date) with a cooling-off window on wallet changes. |
| **Network security** | Public API Gateway | **WAF** (managed rules + rate-based) in front of CloudFront/API Gateway; API Gateway usage plans/throttling; move data-plane Lambdas to **private subnets** with VPC endpoints for DynamoDB/Secrets Manager; least-privilege IAM per function (already per-Lambda). |
| **Money integrity** | Integer pesewas, atomic debit | Keep. Add: signed/append-only ledger export, settlement reconciliation, and a **kill-switch** (SSM flag) to halt initiation per provider/merchant. |
| **Supply chain & SDLC** | Lint/build/tests, `/security-review` | Dependency + container scanning in CI, SBOM, branch protection, mandatory review, secret-scanning, and the existing security-review as a gate. Pen-test before go-live (concept Appendix C). |

### 1.3 Provider integration (mock → real, without regression)
The `PaymentProvider` seam (D1) already isolates this. Production work:
- Implement `MtnMomoProvider` (Collections: Request-to-Pay + status poll + callback, concept §17) behind the same interface; the **contract tests** written by the test suite must pass unchanged — that's the proof the switch is safe.
- Add a **status-poll reconciler** (not just the sweeper): MTN is async, so poll pending refs as a fallback when callbacks are delayed/lost (concept §17.8).
- Multi-provider: add Telecel/AT/GhanaPay adapters + a routing policy in the orchestrator; keep GhIPSS/GhQR as the interoperable QR standard decision (concept §21).

---

## 2. Scale

30k–1M merchants is the concept's target (§15). The serverless base scales horizontally already; the work is removing the few non-linear spots.

- **Kill portal polling → push.** The single biggest scale *and* cost *and* latency win (see §3). Today `/pay` polls status every 2 s; replace with **WebSocket (API Gateway WebSocket) or SSE**, or lean on the soundbox as the confirmation channel. Removes ~8 requests/payment from API Gateway and the payer's data bill.
- **DynamoDB**: on-demand scales automatically; switch hot tables to **provisioned + auto-scaling** once traffic is predictable (cheaper at steady high volume). The single-table-vs-per-domain choice (ADR-2) holds; watch the payments table's GSIs (sweeper GSI2 on `status` is a potential hot partition — shard by time bucket if needed).
- **EventBridge + SQS**: already the fan-out with DLQs; add archive + replay for reprocessing. The announcer/credit-back/audit consumers scale independently.
- **Sweeper at scale**: the 1-minute full-scan on GSI2 won't scale to millions of open payments — move to a **per-payment TTL/Step Functions timer** or a sharded time-bucketed sweep.
- **IoT Core**: handles millions of devices; per-device certs (production) instead of the PoC's Cognito identities. Presence via lifecycle events (already designed).
- **Regionalisation**: deploy close to Ghana (see §3.1) and consider active-passive DR in a second region; DynamoDB Global Tables if multi-region active-active is ever needed.
- **Load model + game-days**: define the pilot target (concept §22: 100 → 1,000 → 10,000 vendors) and load-test each tier; chaos/game-day the webhook and announcement paths.

---

## 3. Latency & connectivity in Ghana (the crux)

Constraints: **mobile data is expensive, coverage is patchy, RTT is high** (a us-east-1 deployment is ~120–150 ms+ RTT from Accra before app overhead; every extra round-trip is money and delay for the payer).

### 3.1 Put the platform physically close to Ghana
- **AWS**: `af-south-1` (Cape Town) is the nearest region; `eu-west-1` (Ireland) often has competitive latency to West Africa via subsea cables and full service parity. Benchmark both from Accra before choosing. **CloudFront edge** (there are African PoPs, incl. Accra/Lagos) serves the portal assets and terminates TLS near the user even if the API is farther.
- **Azure** (if the estate goes Azure): South Africa North.
- Keep the **soundbox MQTT** connection persistent — MQTT frames are tiny and a kept-alive TLS session avoids repeated handshakes over lossy links.

### 3.2 Cut round-trips and bytes (this is where the data-cost lives)
Per-payment data on the **payer's phone** today (rough): QR resolve ~1 KB + initiate ~1 KB + ~8 status polls ×0.5 KB = **~6 KB**. The polls are ~4 KB of that and are pure waste on expensive data.
- **Eliminate polling** → WebSocket/SSE (one connection, server pushes the result) or **no status channel at all**: the customer trusts the **vendor's soundbox announcement** as proof (this is the core fraud-prevention story anyway). That drops payer data to ~2 KB/payment.
- **Minimise payloads**: strip responses to essentials, gzip/brotli (CloudFront does this), small QR-resolve responses, no chatty telemetry on the payer path (sample it — see §5).
- **USSD fallback** (concept §7.2) for feature phones / no-data customers — zero app data, works on 2G. High-value for Ghana; the platform already models it.
- **SMS/WhatsApp confirmation** as a data-free receipt channel.
- **Soundbox data budget** (the always-on cost): MQTT keepalive + a 60 s heartbeat + occasional announcements ≈ a few KB/hour. Widen the heartbeat interval (e.g. 5 min) and drop QoS-0 chatter to shrink the SIM data plan; use a low-cost IoT/M2M SIM. Persistent session replays missed announcements after coverage gaps (already designed, concept §15 offline tolerance).

### 3.3 Resilience to patchy coverage
- Soundbox: persistent MQTT session + last-event replay + on-device dedupe (already built).
- Payer: make the pay flow **resumable** — if the network drops after "pay", the soundbox still announces and an SMS receipt still arrives; the portal reconnects to the same payment id.
- Backend: the sweeper/reconciler guarantees no payment is left ambiguous even if a callback is lost.

---

## 4. Cost

- **Infra** is not the dominant cost at pilot scale (PoC idle ≈ $1/mo; see `cost-review.md`). The levers that matter: **polling → push** (fewer API Gateway requests), right-sizing DynamoDB, and log-retention discipline.
- **Payer data cost** (a Ghana-specific "cost"): addressed in §3.2 — cutting polling roughly thirds the per-payment bytes.
- **Soundbox SIM cost**: the recurring per-device cost; minimise with MQTT + wide heartbeats + M2M data tariffs; consider Wi-Fi/hotspot models for fixed stalls (concept §17.9 hardware trade-offs).
- **Provider fees** (MTN MoMo per-transaction) dominate unit economics but are a business/commercial decision, not infra — model them in the merchant fee design (concept §21).
- Put an **AWS Budgets alarm** and per-tag Cost Explorer reporting in prod (already tagged `Project`/`Environment`).

---

## 5. Tracking latency during a Ghana field test (concrete, implementable)

Goal: when this is trialled in Accra, produce a **real dataset** of end-to-end and per-hop latency, correlated with network conditions — so decisions (region choice, polling-vs-push, USSD) are evidence-based, not guessed.

### 5.1 Instrument every hop with a shared correlation id
Stamp a `payment_id`-keyed timeline; each component records a timestamp:

| Marker | Where | Captured |
| --- | --- | --- |
| `t0_scan` | payer portal (client) | QR opened / Pay tapped |
| `t1_initiate` | Payment API Lambda | request received |
| `t2_provider_cb` | Webhook receiver | provider callback received |
| `t3_ledger` | ledger write | SUCCESS committed |
| `t4_announce_pub` | announcer | published to `devices/{id}/payments` |
| `t5_soundbox_ack` | soundbox | `played` heartbeat (already published!) |
| `t6_confirmed` | payer portal (client) | UI shows Confirmed |

Most of these already exist as ledger `EVT#` items and the soundbox `played` ack — this is mostly **capturing timestamps already flowing**, plus two client beacons (`t0`, `t6`).

### 5.2 Client-side beacons (payer + soundbox)
- Add a tiny **`POST /v1/telemetry`** endpoint (fire-and-forget, sampled). The payer portal sends `{payment_id, marker, ts, net}` where `net` = `navigator.connection.effectiveType` (2g/3g/4g/slow-2g), `downlink`, `rtt` — the **network context is the whole point** for Ghana.
- The soundbox already heartbeats; add `announce_received_ts` and `played_ts` to its ack so device-side latency (broker→speak) is measured, plus RSSI/signal from the heartbeat.
- Keep beacons **small and sampled** (e.g. 100 % during the field test, low % afterwards) so telemetry doesn't itself burn payer data.

### 5.3 Store, aggregate, visualise
- Write markers to a **telemetry table** (or CloudWatch **EMF** metrics for automatic p50/p95/p99) keyed by `payment_id`.
- Compute per-hop deltas (`t1-t0`, `t2-t1`, … `t6-t0` total) and segment by **network type, carrier, time of day, region**.
- **Dashboard**: CloudWatch (or a small results page) showing total and per-hop percentiles, and the **payment→announcement time vs the <5 s target** (concept §15), broken down by 2G/3G/4G.
- **Exportable dataset** (CSV/Athena over the telemetry table) so the field-test data can be analysed offline.

### 5.4 Baseline & synthetic probes
- Run a **synthetic probe from a Ghana vantage point** (a cheap VM/edge in-region, or a phone running a scripted loop) to measure raw RTT to the API and IoT endpoints independent of app logic — establishes the network floor.
- Compare **region candidates** (af-south-1 vs eu-west-1 vs us-east-1) with the same probe before committing (§3.1).
- Optionally **CloudWatch RUM / App Insights** for real-user web metrics, but a custom beacon is cheaper and controllable on expensive data.

### 5.5 What the data answers
- Is the <5 s payment→announcement target met on 3G? On 2G?
- How much latency is *network* (t0→t1, t4→t5) vs *platform* (t1→t4)? → tells you whether region choice or code is the lever.
- Does eliminating polling measurably cut payer-perceived time and data?
- Which carriers/areas are worst → informs USSD-fallback prioritisation.

> This is a **~1–2 day build** (telemetry endpoint + client beacons + a dashboard) and is the highest-value thing to add *before* a Ghana trial, because it turns the trial into measurement rather than anecdote. It can be added behind a flag without touching the payment path's correctness.

---

## 6. Suggested sequencing

1. **Latency telemetry (§5)** — do first; cheap, and everything else benefits from the data.
2. **Region benchmark (§3.1)** — pick af-south-1 vs eu-west-1 with real numbers.
3. **Polling → push (§2/§3.2)** — biggest scale/cost/latency win.
4. **Security hardening (§1)** — signature verification, Secrets Manager + rotation, Cognito RBAC, WAF, PII tokenisation — gate for handling real money.
5. **Real MTN adapter (§1.3)** behind the green contract tests; reconciler; fraud controls.
6. **Scale items (§2)** — sweeper redesign, DynamoDB provisioning, load tests per pilot tier.
7. **Compliance (§1.1)** — BoG/aggregator + Data Protection registration — in parallel, long lead time.
