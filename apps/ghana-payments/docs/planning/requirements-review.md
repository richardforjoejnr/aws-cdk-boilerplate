# Requirements Review — Ghana Street Vendor Payment & Soundbox Platform (PoC)

**Reviewer role:** Software Requirements Analyst (skeptical tester lens)
**Date:** 2026-07-11
**Inputs reviewed:**
- `docs/concept.md` — full production architecture spec (§1–§22 + Appendices A–D). *Context/target, not PoC requirements.*
- `docs/planning/poc-decisions.md` — locked PoC decisions D1–D6 + out-of-scope list. *Fixed constraints.*
- `packages/ghana-payments/CLAUDE.md` and `README.md` — AWS serverless deployment context (Lambda + API Gateway + DynamoDB + EventBridge + IoT Core + S3; CDK monorepo).

**Scope of this review:** the **PoC**, whose acceptance scenario is the **D5 demo loop**:
> scan QR → mock-wallet portal opens → guest enters GHS 20 → taps Pay → payer screen shows *pending* → mock provider confirms async → **idempotent** webhook → **ledger** records SUCCESS → MQTT publish → **browser soundbox speaks** → payer screen flips to *Confirmed*.

The full spec's NFRs (99.5% availability, 1M merchants, localization, settlement) are treated as context. Where the PoC **silently inherits or drops** one, it is flagged — but not scored as a PoC gap.

---

## 1. Scope and dimensional relevance

The PoC is a single deployable AWS-serverless package (`packages/ghana-payments`) that proves one narrative end to end: a vendor gets **trustworthy audio confirmation** of a digital payment, processed **idempotently**, with the deliberate *pending-vs-soundbox gap* that dramatises the fake-screenshot fraud story (D5). MTN is fully mocked behind a `PaymentProvider` interface (D1/D2); the QR encodes a URL to a hosted mock-wallet portal (D3); the soundbox is a browser Web-Speech simulator over MQTT-over-WebSocket on IoT Core (D4); settlement, USSD, SMS/WhatsApp, agent app, admin portal, KYC and real firmware are out of scope.

**Personas in PoC scope:** an **Operator/Developer** (does the work the out-of-scope agent app and admin portal would do — seeds merchants, binds devices, runs reports via API/CLI), the **Customer/Guest payer** (drives the portal), the **Vendor** (passive beneficiary — hears the soundbox), and the **System**. The **Field Agent**, **Platform Admin**, and **Payment Partner** personas from §4 are out of scope; their responsibilities collapse onto the Operator.

**SFDIPOT dimensions — relevance:**
- **Structure, Function, Data, Interfaces** — fully relevant; the core of this review.
- **Platform** — relevant and under-specified (IoT Core browser auth, Web Speech autoplay, API Gateway SSE, portal hosting). Examined.
- **Operations** — partially relevant. Normal + disfavored (double-tap, bad amount, duplicate callback) matter for the demo. Admin/maintenance ops (backup, OTA, device replacement) are out of scope — examined only where they leak into the loop.
- **Time** — relevant and thin. The 2–3 s async delay, the TIMEOUT outcome, poll interval/expiry, and announce-once timing are all live concerns. Examined. Time-zone/scheduling/end-of-day concerns are minimal (Ghana is UTC+0) and noted only for reporting.

**Story-map structure chosen:** `Goal > Activities > Tasks > Stories`, with the **backbone = the D5 demo loop in narrative order**. This is the right structure because the PoC's value *is* one linear user journey; a user-driven multi-persona map would over-model out-of-scope actors. Reporting is modelled as a trailing activity outside the demo backbone.

---

## 2. Story Map

### 2(a) Backbone — Activities (left-to-right narrative order)

| 1. Provision merchant & device | 2. Generate & display QR | 3. Customer pays via portal | 4. Process payment | 5. Announce via soundbox | 6. Report & verify |
|---|---|---|---|---|---|
| Operator | Operator | Customer/Guest | System | Soundbox (virtual) / Vendor | Operator/Analyst |

Activities **1–5 are the D5 demo backbone**. Activity 6 is PoC scope but sits *outside* the acceptance loop (second slice).

### 2(b) Tasks and Stories

> **Activity 1: Provision merchant & device** — *Actor: Operator*
>
> - **Task 1.1: Create merchant profile**
>   - ⭐ R-1.1.a *Create merchant* — persist `display_name` (shown on portal), wallet MSISDN (tokenized), status ACTIVE; via API or seed script — *src §8.1, §11, §17.4*
>   - 🟢 R-1.1.b *Attach wallet* — `merchant_wallets` / provider+wallet_number — *src §8.1 /wallets, §11*
>   - 🚫 R-1.1.c *KYC / ghana_card capture* — out of scope — *src poc-decisions "Out of scope"*
>   - 🚫 R-1.1.d *Merchant suspend/reactivate lifecycle* — deferred — *src §8.1, §20*
> - **Task 1.2: Register & bind the virtual soundbox**
>   - ⭐ R-1.2.a *Register device + bind to merchant* — minimal `devices`/`device_pairings` row so webhook can resolve merchant→device — *src §8.4, §11, §17.6 device lookup*
>   - ❓ R-1.2.b *Pairing ceremony* (agent scans serial → pairing code → 1 GHS test txn → ACTIVE) — **assumed replaced** by direct Operator bind — *src §10.2*
>   - 🚫 R-1.2.c *Heartbeat / health / OTA / status lifecycle* — out — *src §8.4, §10.1, §17.8*
>
> **Activity 2: Generate & display QR** — *Actor: Operator*
>
> - **Task 2.1: Generate QR encoding the portal URL**
>   - ⭐ R-2.1.a *Generate QR* — `qrcode` renders `{PUBLIC_BASE_URL}/pay/{qr_id}` as PNG/SVG; store `qr_id → merchant_id`, status ACTIVE — *src D3.1, §8.2*
> - **Task 2.2: QR lifecycle management**
>   - 🚫 R-2.2.a *Rotate / deactivate / mark COMPROMISED* — out (fraud control, post-PoC); portal merchant-name is the *retained* anti-tamper control — *src §8.2, §12.1, §20*
>
> **Activity 3: Customer pays via portal** — *Actor: Customer/Guest*
>
> - **Task 3.1: Resolve QR & render portal page**
>   - ⭐ R-3.1.a *Resolve `/pay/{qr_id}`* → mobile page showing **merchant name** + amount field + Pay button — *src D3.2, §8.2 resolve, §12.1*
>   - ⚠️ R-3.1.b *Invalid / inactive / unknown `qr_id`* — behaviour undefined — *gap*
> - **Task 3.2: Enter amount & initiate payment**
>   - ⭐ R-3.2.a *POST `/v1/payments`* (amount, merchant, mock-outcome selector) → returns `payment_id`, status INITIATED/PENDING — *src §8.3, D3.3*
>   - ⚠️ R-3.2.b *Amount validation* (min/max/zero/negative/decimal → pesewas) — undefined — *gap*
>   - ⚠️ R-3.2.c *Double-tap / initiation idempotency* — undefined — *gap*
> - **Task 3.3: Show live status (pending → confirmed)**
>   - ⭐ R-3.3.a *Poll `/v1/payments/{id}`* → flip to "Confirmed ✓" on SUCCESS — *src D3.4, D5*
>   - ⚠️ R-3.3.b *Render FAILED / EXPIRED / stuck-TIMEOUT* terminal states — undefined — *gap*
>   - 🟢 R-3.3.c *SSE instead of polling* — later (API GW REST feasibility) — *src D3.4*
>
> **Activity 4: Process payment (mock provider → webhook → ledger)** — *Actor: System*
>
> - **Task 4.1: Provider adapter**
>   - ⭐ R-4.1.a *`PaymentProvider` interface + `MockMomoProvider`* (`initiatePayment`, `getStatus`) — *src D1*
>   - ⭐ R-4.1.b *Configurable outcome* SUCCESS/FAILED/TIMEOUT/DUPLICATE with 2–3 s async callback — *src D1, §17.1, §17.8*
>   - 🟢 R-4.1.c *MTN sandbox adapter + contract tests on both* — later — *src D1, D2*
> - **Task 4.2: Idempotent webhook receiver**
>   - ⭐ R-4.2.a *Persist raw payload to S3 event inbox before processing*; return 2xx only after durable write — *src Appendix B, D6.2*
>   - ⭐ R-4.2.b *Idempotent ledger write* — dedupe on `provider_transaction_id` (+ `payment_id`) so DUPLICATE posts once — *src Appendix B, §12.1, D5*
>   - ❓ R-4.2.c *HMAC / signature verification* — **assumed out** for mock (no shared secret); revisit for sandbox — *src Appendix B, §6, §12*
>   - 🟢 R-4.2.d *Replay / timestamp-window protection* — later — *src Appendix B*
> - **Task 4.3: Ledger**
>   - ⭐ R-4.3.a *Payment record in DynamoDB* — integer **pesewas**, status machine INITIATED→PENDING→SUCCESS/FAILED — *src §11, §20, CLAUDE.md*
>   - ⭐ R-4.3.b *`payment_events` history* (append per callback) — *src §11, §17.4*
>   - ⚠️ R-4.3.c *TIMEOUT handling* — status-poll fallback / expiry sweeper needs a scheduler; not in D6 phase list — *gap*
>   - 🟢 R-4.3.d *Emit payment event to EventBridge* — *src README mapping, §5*
>
> **Activity 5: Announce via soundbox** — *Actor: Soundbox (virtual) / Vendor*
>
> - **Task 5.1: Publish confirmation to MQTT**
>   - ⭐ R-5.1.a *On SUCCESS, publish to `devices/{device_id}/payments`* on IoT Core — *src §10.1, D4*
>   - ⚠️ R-5.1.b *Announce-once idempotency* (`announced_at` guard) so DUPLICATE speaks once — *src §17.6, §17.8*
> - **Task 5.2: Browser soundbox speaks**
>   - ⭐ R-5.2.a *Web page subscribes MQTT-over-WS + Web Speech announces amount* — *src D4*
>   - ⚠️ R-5.2.b *IoT Core WS auth (SigV4/Cognito) + browser autoplay/gesture* — undefined — *gap*
>   - ⭐ R-5.2.c *Headless Node subscriber for automated tests* — *src D4*
>   - 🚫 R-5.2.d *Offline recovery / missed-event resync* — out/deferred — *src §15, §17.8*
>
> **Activity 6: Report & verify** *(outside the demo backbone)* — *Actor: Operator/Analyst*
>
> - **Task 6.1: Transaction list & daily sales**
>   - 🟢 R-6.1.a *List transactions per merchant + daily totals* via API/CLI (admin portal out) — *src §18 Basic reporting, D6.5*
> - **Task 6.2: Reconciliation export**
>   - 🚫 R-6.2.a *Reconcile against provider report* — out (no real provider report exists) — *src §13 MVP, §18*

### 2(c) Release slices

| Slice | Contents | Walking-skeleton test |
|---|---|---|
| **MVP / Demo (R1)** | All ⭐ stories in Activities 1–5 | **Y** — traverses the entire D5 backbone (provision → QR → pay → process idempotently → speak). This *is* the acceptance scenario. Reporting (Activity 6) is deliberately excluded; it is not part of the demo loop. |
| **R2 (rest of PoC)** | 🟢 stories: R-1.1.b wallet, R-3.3.c SSE, R-4.1.c MTN sandbox+contract tests, R-4.2.d replay, R-4.3.d EventBridge, R-6.1.a reporting | Adds real-provider readiness, richer status transport, event-driven decoupling, and the reporting activity. Value: proves the mock is swappable and closes the PoC's stated scope (D6 phase 5). |
| **Out of scope** | 🚫 stories: KYC, merchant/QR/device lifecycle, OTA/heartbeat, offline resync, reconciliation, settlement, USSD, SMS/WhatsApp | Per poc-decisions out-of-scope list; fraud/lifecycle controls belong to the production platform. |
| **Assumptions to validate** | ❓ R-1.2.b pairing skip, ❓ R-4.2.c signature-off | Must be confirmed before Activity 1 and Activity 4 build respectively. |

### 2(d) Story-map gap analysis (≤7)

- **Activity 4 / Task 4.3 has an unresolved TIMEOUT story (R-4.3.c).** The mock produces TIMEOUT as a first-class outcome, but no story/phase covers the status-poll-fallback or expiry sweeper the concept (§17.8) says is required. This is the biggest hole in the backbone: one of four mock outcomes has undefined system behaviour.
- **Activity 3 / Task 3.3 is happy-path only.** R-3.3.a defines "Confirmed"; FAILED/EXPIRED/stuck-pending rendering (R-3.3.b) is undefined — 3 of 4 mock outcomes have no portal UI.
- **Activity 5 / Task 5.2 has a blocking platform gap (R-5.2.b).** Browser→IoT-Core auth and Web-Speech autoplay are unspecified; without them the soundbox — the whole point of the demo — may not fire.
- **Activity 1 / Task 1.2 relies on an assumption (R-1.2.b).** Pairing is out of scope but the webhook's merchant→device lookup needs *some* binding path. The seed/bind mechanism is undefined.
- **Persona coverage:** Vendor is passive (never interacts) and the Operator absorbs three out-of-scope personas. Acceptable for a PoC, but means no story ever exercises "vendor sets something up" — fine, flagged so it isn't mistaken for a miss.
- **Column imbalance:** Activity 4 (process) carries the most stories and the most risk; Activities 2 and 6 are thin. This matches where correctness lives (idempotency/ledger), so the imbalance is intentional, not neglect.
- **No orphan stories.** Every story maps to a task; every task to a backbone activity.

---

## 3. SFDIPOT reasoning notes

**Structure.** The PoC collapses the §5 seven-layer / §14 container architecture onto Lambda+API GW+DynamoDB+EventBridge+IoT+S3 (README table). One structural ambiguity dominates: **is EventBridge in the critical path of the demo loop, or does the webhook Lambda publish to IoT Core directly?** D5 reads "webhook → ledger → MQTT" (direct); the README maps the broker to EventBridge (indirect). This decides where idempotency and the `announced_at` guard live, and affects latency. Also unresolved: DynamoDB **single-table vs per-domain tables** (CLAUDE.md calls it open). Both must be settled before Task 4.3 is built.

**Function.** The core function — idempotent webhook → ledger → announce — is well-motivated but the **state machine is under-specified for non-SUCCESS paths**. §20 defines 7 payment statuses (INITIATED, PENDING, SUCCESS, FAILED, EXPIRED, REVERSED, REFUNDED); the demo only exercises SUCCESS. FAILED/TIMEOUT/DUPLICATE handling in ledger, portal and soundbox is the dominant functional gap (see §4). The `INITIATED` vs `PENDING` distinction is never pinned to a trigger (does POST return INITIATED, and PENDING arrive only when the mock "accepts"? or is POST already PENDING?).

**Data.** Three unresolved data questions. (1) **"Ledger" semantics** — §11 `payments` is a *mutable* row (status/confirmed_at updated in place) yet the word "ledger" implies append-only. The PoC must decide: mutate the payment item, or append immutable ledger/`payment_events` entries with the payment item as a projection? This determines the idempotency mechanism (conditional update vs conditional put). (2) **Money** — CLAUDE.md mandates integer **pesewas**; the concept uses floats (`20.0`, `NUMERIC(12,2)`). GHS↔pesewas conversion, rounding, and how the portal amount field maps to storage are undefined. (3) **Idempotency key provenance** — `payment_id` is platform-generated at initiation; `provider_transaction_id` is provider-generated. For the mock, *the mock must generate `provider_transaction_id` and reuse it identically on the DUPLICATE callback* — otherwise the idempotency demo is untestable. This generation rule is unwritten. Also: **event-inbox (S3 raw) vs `payment_events` (DynamoDB) vs EventBridge** are three "event" concepts whose relationship is undefined.

**Interfaces.** REST surface (§8) is well-specified for the full platform, but the PoC subset is not delineated — which endpoints actually ship? At minimum `/pay/{qr_id}` (HTML, not in §8), `POST /v1/payments`, `GET /v1/payments/{id}`, `POST /v1/webhooks/{provider}`. The `/pay/{qr_id}` **portal page is an interface the §8 API design does not mention** (it's a D3 addition) — its contract (HTML? error page? content) is undefined. `GET /v1/payments/{id}/verify` (force poll) is needed if TIMEOUT is handled but isn't in the phase plan. MQTT topic uses `device_id` in §10.1 but `mqtt_client_id` in §17.6 — pick one for IoT Core.

**Platform.** Deployability has two under-specified blockers unique to the browser-based choices. (1) **AWS IoT Core MQTT-over-WebSocket requires SigV4 auth** — a browser needs Cognito Identity Pool credentials (or a custom authorizer); D4 says "IoT Core supports it" but never says *how the page authenticates*. (2) **Web Speech API autoplay** — most browsers block `speechSynthesis` without a prior user gesture; a passively-watching soundbox tab may stay silent. (3) **Portal hosting/SSE** — is `/pay/{qr_id}` served by a Lambda behind API GW, or static on CloudFront? API Gateway REST does not support SSE cleanly, so R-3.3.c (SSE) may be infeasible without HTTP API/ALB — polling is the safe default. (4) `PUBLIC_BASE_URL` must be resolvable at QR-generation time to the deployed API GW/CloudFront domain (custom domain vs execute-api URL).

**Operations.** Normal path is clear. **Disfavored use is the demo's whole point yet thinly specified:** duplicate callback (DUPLICATE outcome — the idempotency story), fake screenshot (covered by "trust only the soundbox"), double-tap Pay, malformed amount. Admin/maintenance ops (device replacement, OTA, backup, reconciliation) are correctly out of scope. Who plays the Operator (seeds merchant, binds device, triggers the mock outcome) and *how they select the mock outcome per payment* (query param? header? per-merchant config?) is undefined and needed for a repeatable demo.

**Time.** The deliberate 2–3 s async delay is specified. Unspecified: **poll interval and total poll budget** on the portal (R-3.3.a); **when a TIMEOUT payment becomes EXPIRED** (the sweeper cadence, R-4.3.c); **MQTT message TTL** (sample uses `ttl_seconds: 300`) and whether an expired announcement is suppressed; **announce-once timing** under a race (two DUPLICATE callbacks arriving near-simultaneously — the `announced_at` guard needs a conditional write, not a read-then-write). Time-zone/end-of-day only matters for reporting daily totals (Ghana = UTC+0, low risk).

---

## 4. Ambiguities, Gaps & Contradictions (detailed)

**A. Webhook idempotency vs the mock provider design.**
- *Contradiction/gap.* Appendix B mandates **signature validation** ("Reject unsigned callbacks") and **replay protection**. The mock has no shared secret and MTN MoMo Open API callbacks are not HMAC-signed in the classic sense — so signature verification is both un-buildable for the mock and questionable for the sandbox target. poc-decisions and CLAUDE.md conflict here: CLAUDE.md's security baseline echoes "signed webhooks" (from §18), but poc-decisions is silent. **Decide explicitly: signature verification is out for the PoC (assumption R-4.2.c) and idempotency is the retained control.**
- *Two different idempotencies conflated.* There is **ledger idempotency** (dedupe the ledger write on `provider_transaction_id`) and **announce idempotency** (the §17.6 `announced_at` guard so the soundbox speaks once). D5 says "idempotent webhook → ledger"; the sample code only implements announce-once. The PoC needs **both**, and both must be **conditional DynamoDB writes** (not read-then-write) to survive near-simultaneous DUPLICATE callbacks.
- *Idempotency key undefined for the mock.* The mock must emit a stable `provider_transaction_id` and reuse it verbatim on the DUPLICATE callback; otherwise DUPLICATE is indistinguishable from a second payment. Unwritten.

**B. What "ledger" means in DynamoDB.**
- Unresolved append-only-vs-mutable (see Data note). Recommend: **payment item** (current status, keyed by `payment_id`) + **append-only `payment_events`** (keyed `payment_id` + `event_id`/timestamp), with the idempotent write being a *conditional put* of the event keyed on `provider_transaction_id`. Single-table vs per-domain still open (CLAUDE.md). This must be an ADR before Task 4.3.

**C. pending → confirmed lifecycle on the portal.**
- Which internal status renders as "pending" — INITIATED, PENDING, or both? "Confirmed ✓" = SUCCESS only. **FAILED, EXPIRED, and stuck-TIMEOUT have no defined portal rendering** (R-3.3.b). The demo deliberately keeps the payer on "pending" while the soundbox is the real proof — but a payer on a FAILED payment must not sit on "pending" forever. Define terminal-state copy and a client-side poll timeout.

**D. Device pairing scope for a virtual device.**
- §10.2 pairing (agent, serial scan, pairing code, 1 GHS test txn) depends on the out-of-scope agent app. But the webhook's `merchant → active device` lookup (§17.6) needs a binding to exist. **The seed/bind path that replaces pairing is undefined** (R-1.2.b assumption). Also unresolved: is it 1 merchant → 1 device (LIMIT 1 in the sample) for the PoC? And `device_id` vs `mqtt_client_id` as the topic segment.

**E. FAILED / TIMEOUT / DUPLICATE in UI and soundbox.**
- **SUCCESS** — portal Confirmed, soundbox speaks once. *Defined.*
- **FAILED** — ledger FAILED; portal should show a failure state (undefined); soundbox **silent** (only SUCCESS announces — confirm this is intended).
- **TIMEOUT** — *the largest gap.* Does the mock fire **no callback** (portal stuck pending → needs status-poll fallback + expiry to EXPIRED), or a callback carrying a timeout status? The concept (§17.8) requires scheduled polling by reference ID, but **no poller/sweeper is in the D6 phase list**. Either add it (EventBridge Scheduler / Step Functions) or explicitly define TIMEOUT as "portal shows pending, then EXPIRED after N seconds via a sweeper."
- **DUPLICATE** — mock fires the callback twice with the same `provider_transaction_id`; idempotent webhook must post to the ledger once and the soundbox must speak once. This is the idempotency demo and must be an automated test.

**F. QR lifecycle (rotate / compromise) relevance to PoC.**
- §8.2 rotate/status and §20 QR statuses (ROTATED/COMPROMISED) are fraud controls **out of the demo loop**. poc-decisions doesn't list them as out of scope — it just omits them. **Mark them explicitly OUT** (R-2.2.a) to prevent scope creep. The one retained fraud control is the **merchant name on the portal** (D3.2 / §12.1) — good, and worth stating as the deliberate anti-tamper surface.

**G. Error/edge behaviour undefined for the demo loop.**
- Invalid/unknown/inactive `qr_id` → 404 vs error page (R-3.1.b).
- Amount validation: zero, negative, non-numeric, decimals, very large, currency assumptions; GHS→pesewas conversion (R-3.2.b).
- Double-tap Pay → duplicate *payments* (initiation idempotency, distinct from webhook idempotency) (R-3.2.c).
- Concurrent payments to one merchant → which the soundbox announces / ordering.
- Soundbox tab closed at announce time (device "offline") — store-and-forward is §17.8 but marked out for PoC (R-5.2.d); confirm the demo simply requires the tab open.
- IoT Core WS auth failure / Web Speech blocked → silent failure with no operator signal (R-5.2.b).

**H. Silently inherited / dropped production NFRs (flagged, not scored).**
- **Latency <5 s (§15)** — feasible (2–3 s mock + Lambda + IoT) but *not* an acceptance criterion; effectively dropped/untested. Consider asserting it in the demo test.
- **Availability 99.5%, 10k–1M merchants (§15)** — dropped; correct for a PoC.
- **Localization (§15, Twi/Ga/Ewe)** — dropped; the sample hardcodes `en` / "Ghana cedis". Fine, but note the soundbox string is English-only.
- **Signature verification / replay (§6, Appendix B, §18 baseline)** — silently dropped (see A). Make it explicit.
- **Tokenization of MSISDN/ghana_card (§12, CLAUDE.md)** — *retained* by CLAUDE.md ("tokenize/hash, never log"), but with KYC out, only wallet MSISDN remains to protect. Confirm the tokenization requirement still applies to the seeded wallet number and that no MSISDN is logged.
- **Settlement/reconciliation (§13)** — dropped beyond ledger records; correct.

---

## 5. Clarifying Questions (sorted by Dimension)

| # | Dimension | Story Map Location | Requirement Area | Question | Assumed Answer | Criticality |
|---|---|---|---|---|---|---|
| 1 | Structure | A4 / T4.3 & A5 / T5.1 | Webhook/ledger, MQTT | Is EventBridge in the demo critical path (webhook → EventBridge → publisher → IoT), or does the webhook Lambda write the ledger and publish to IoT **directly**? | Direct for the demo; EventBridge added in R2 (R-4.3.d) | **Blocking** |
| 2 | Structure | A4 / T4.3 | Ledger | DynamoDB **single-table** or **per-domain** tables for merchants/qr/payments/events/devices? | Per-domain tables (simpler to reason about for PoC) | **Blocking** |
| 3 | Data | A4 / T4.2, T4.3 | Webhook/ledger | Does "ledger records SUCCESS" mean **mutate the payment item** in place, or **append an immutable `payment_events` entry** with the payment item as a projection? | Payment item + append-only events; idempotent conditional put on the event | **Blocking** |
| 4 | Data | A4 / T4.2 | Mock provider / webhook | Which field is the **idempotency key** — `provider_transaction_id`, `payment_id`, or both — and must the mock reuse the *same* `provider_transaction_id` on the DUPLICATE callback? | `provider_transaction_id` primary; mock reuses it identically on DUPLICATE | **Blocking** |
| 5 | Data | A1 / T1.1, A3 / T3.2 | Merchant / payment initiation | Confirm money is stored as **integer pesewas**; define GHS→pesewas conversion and rounding at the portal amount field. | Integer pesewas; portal accepts GHS decimal, ×100, reject >2dp | High |
| 6 | Data | A4 / T4.2, T4.3 | Webhook/ledger | What is the relationship between the **S3 raw event inbox**, the DynamoDB **`payment_events`**, and **EventBridge**? Which is authoritative for audit? | S3 = raw audit; `payment_events` = normalized history; EventBridge = R2 fan-out | High |
| 7 | Function | A4 / T4.3, A3 / T3.3 | Payment lifecycle | What triggers the **INITIATED → PENDING** transition, and which states render as portal "pending"? | POST returns PENDING; both INITIATED/PENDING render "pending" | High |
| 8 | Function | A4 / T4.3 | Mock provider / ledger | On **TIMEOUT**, does the mock fire **no callback** (needing a status-poll/expiry sweeper) or a callback with timeout status? | No callback; sweeper marks EXPIRED after N s | **Blocking** |
| 9 | Function | A4 / T4.3 | Ledger / scheduler | Is a **status-poll fallback / expiry sweeper** (EventBridge Scheduler or Step Functions) in PoC scope? It is absent from the D6 phase list but implied by TIMEOUT. | Minimal sweeper in MVP (needed for TIMEOUT); full poller in R2 | **Blocking** |
| 10 | Function | A3 / T3.3, A5 / T5.2 | Portal / soundbox | For **FAILED**: what does the portal show, and does the soundbox stay **silent**? | Portal shows "Payment failed"; soundbox silent | High |
| 11 | Function | A5 / T5.1 | MQTT / idempotency | Is announce-once enforced by a **conditional write** on `announced_at` (race-safe), not read-then-write? | Conditional write | High |
| 12 | Function | A3 / T3.2 | Payment initiation | Is **initiation idempotency** required (double-tap Pay → one payment), e.g. via an idempotency key from the portal? | Yes — client idempotency key or short dedupe window | Medium |
| 13 | Interfaces | A3 / T3.1 | QR/portal | What is the **`/pay/{qr_id}` contract** — server-rendered HTML via Lambda, or static SPA calling the API? And its error page for bad `qr_id`? | Lambda-rendered HTML behind API GW; 404 page for unknown/inactive | High |
| 14 | Interfaces | global | API surface | Which **§8 endpoints actually ship** in the PoC vs are deferred? | `/pay/{qr_id}`, `POST/GET /v1/payments`, `POST /v1/webhooks/{provider}`, minimal merchant/qr/device create | High |
| 15 | Interfaces | A5 / T5.1 | MQTT | Is the topic segment **`device_id`** (§10.1) or **`mqtt_client_id`** (§17.6)? One canonical identifier. | `device_id`, used as the IoT client id | Medium |
| 16 | Platform | A5 / T5.2 | Soundbox | How does the **browser authenticate to IoT Core** over MQTT-WebSocket — Cognito Identity Pool (SigV4) or a custom authorizer? | Cognito Identity Pool, unauthenticated role scoped to subscribe | **Blocking** |
| 17 | Platform | A5 / T5.2 | Soundbox | How is **Web Speech autoplay** unblocked (browser gesture policy) so the soundbox speaks on a passive tab? | Operator clicks "Enable audio" once to arm speechSynthesis | High |
| 18 | Platform | A3 / T3.1, A2 / T2.1 | Portal / QR | Is the portal hosted on **API Gateway (Lambda)** or **CloudFront/S3**, and what resolves `PUBLIC_BASE_URL` (custom domain vs execute-api)? | API GW custom domain or CloudFront; `PUBLIC_BASE_URL` from a CDK output | High |
| 19 | Platform | A3 / T3.3 | Portal status | Given API GW REST doesn't stream cleanly, is **polling** the MVP transport (SSE deferred)? | Yes, client polling in MVP; SSE only if HTTP API/ALB adopted | Medium |
| 20 | Operations | A1 / T1.2 | Device pairing | How is the virtual device **bound to a merchant** (replacing §10.2 pairing) — seed script, `POST /v1/devices` + `/pair`, or config? One merchant → one device? | Operator seeds device + direct bind; 1:1 for PoC | High |
| 21 | Operations | A3 / T3.2, A4 / T4.1 | Mock provider | How does the Operator **select the mock outcome** per payment (query param, header, per-merchant config)? Needed for a repeatable demo. | Optional request param defaulting to SUCCESS | High |
| 22 | Operations | A1 / T1.1 | Merchant setup | How are merchants **created** for the PoC (seed script vs `POST /v1/merchants`) and what is the minimal field set? | Seed + minimal `POST /v1/merchants` (display_name, wallet MSISDN) | Medium |
| 23 | Operations | global | Security baseline | Is **webhook signature verification** in or out for the PoC (mock has no secret; sandbox isn't HMAC-signed)? | Out; idempotency is the retained control (record as ADR) | High |
| 24 | Time | A3 / T3.3, A4 / T4.3 | Portal / ledger | What are the **poll interval, total poll budget, and TIMEOUT→EXPIRED window**? | Poll ~2 s; give up ~30 s; EXPIRED after ~30 s | Medium |
| 25 | Time | A5 / T5.1 | MQTT | Does the announcement carry a **TTL** (sample `ttl_seconds: 300`), and is an expired announcement suppressed? | TTL present but not enforced in PoC | Low |
| 26 | Data/Security | A1 / T1.1 | Merchant setup | With KYC out, does the **tokenize/never-log MSISDN** rule (CLAUDE.md) still bind the seeded wallet number? | Yes — hash/tokenize, never log | Medium |
| 27 | Function | A5 / T5.2 | Soundbox localization | Is the soundbox string **English-only** for the PoC ("20 Ghana cedis"), and how are pesewas spoken (e.g. "20 cedis 50 pesewas")? | English-only; pesewas remainder spoken if non-zero | Low |
| 28 | Function | A4 / T4.1 | Contract tests | Since the MTN sandbox adapter isn't built in the PoC, are D1 "contract tests against both adapters" **mock-only now**, with the shared contract authored to match §17? | Yes — mock-only contract now, second adapter in R2 | Low |

---

## 6. 8-Point Quality Scorecard

Scored per **PoC requirement area** (not per production requirement). Context-only NFRs are excluded per the brief.

| Req area | Complete | Clear | Consistent | Traceable | Testable | Feasible | Uniquely ID | Necessary |
|---|---|---|---|---|---|---|---|---|
| **Merchant setup** (A1/T1.1) | Partial | Partial | Pass | Pass | Partial | Pass | Fail | Pass |
| **QR / portal** (A2, A3/T3.1) | Partial | Partial | Partial | Pass | Partial | Partial | Fail | Pass |
| **Payment initiation** (A3/T3.2–3.3) | Partial | Partial | Partial | Pass | Partial | Pass | Fail | Pass |
| **Mock provider** (A4/T4.1) | Pass | Pass | Pass | Pass | Pass | Pass | Fail | Pass |
| **Webhook / ledger** (A4/T4.2–4.3) | Fail | Partial | Fail | Pass | Partial | Pass | Fail | Pass |
| **MQTT / soundbox** (A5) | Partial | Partial | Partial | Pass | Partial | Fail | Fail | Pass |
| **Reporting** (A6/T6.1) | Partial | Partial | Pass | Pass | Partial | Pass | Fail | Pass |

**Partial / Fail justifications (keyed by area + criterion):**

- **Merchant setup / Complete — Partial:** creation mechanism (seed vs API) and minimal field set undefined (Q22); wallet attach optional.
- **Merchant setup / Clear — Partial:** "attach wallet" vs single MSISDN (§11 vs §17.4) not reconciled for the PoC.
- **Merchant setup / Testable — Partial:** no acceptance criterion for "merchant exists and is resolvable by QR."
- **Merchant setup / Uniquely ID — Fail:** no requirement IDs in source (this review assigns R-1.1.x).

- **QR/portal / Complete — Partial:** invalid-`qr_id` path, portal HTML contract, hosting all undefined (Q13, R-3.1.b).
- **QR/portal / Clear — Partial:** "polls or SSE" leaves transport ambiguous (Q19); `PUBLIC_BASE_URL` resolution unstated (Q18).
- **QR/portal / Consistent — Partial:** `/pay/{qr_id}` portal is not in the §8 API design it supposedly derives from.
- **QR/portal / Testable — Partial:** no pass/fail for resolve errors or amount validation.
- **QR/portal / Feasible — Partial:** SSE on API GW REST is questionable (Q19); otherwise feasible.
- **QR/portal / Uniquely ID — Fail:** no source IDs.

- **Payment initiation / Complete — Partial:** amount validation, initiation idempotency, INITIATED/PENDING trigger undefined (Q5, Q7, Q12).
- **Payment initiation / Clear — Partial:** "shows pending" doesn't say which internal status; FAILED/EXPIRED rendering absent (Q10, R-3.3.b).
- **Payment initiation / Consistent — Partial:** §20 has 7 statuses; portal models 2 — mapping unstated.
- **Payment initiation / Testable — Partial:** non-SUCCESS outcomes have no expected UI to assert.
- **Payment initiation / Uniquely ID — Fail:** no source IDs.

- **Mock provider / all Pass except Uniquely ID:** D1/D2 are unusually crisp (interface, four outcomes, 2–3 s delay, env selector, contract-test intent). **Uniquely ID — Fail:** no IDs. *Minor residual:* outcome-selection mechanism (Q21) and `provider_transaction_id` reuse rule (Q4) live at the webhook/ledger boundary, scored there.

- **Webhook/ledger / Complete — Fail:** the highest-risk area is the least complete — idempotency key (Q4), ledger append-vs-mutate (Q3), TIMEOUT/sweeper (Q8/Q9), signature in/out (Q23), and S3/events/EventBridge relationship (Q6) all undefined.
- **Webhook/ledger / Clear — Partial:** "idempotent webhook → ledger" conflates ledger-idempotency and announce-idempotency.
- **Webhook/ledger / Consistent — Fail:** Appendix B mandates signature verification and replay protection that the mock design and MTN-sandbox reality contradict; CLAUDE.md "signed webhooks" vs poc-decisions silence.
- **Webhook/ledger / Testable — Partial:** DUPLICATE→post-once is testable *once* the idempotency key is defined; TIMEOUT is not testable until behaviour is defined.
- **Webhook/ledger / Uniquely ID — Fail:** no source IDs.

- **MQTT/soundbox / Complete — Partial:** IoT-Core browser auth and Web-Speech autoplay undefined (Q16, Q17); offline behaviour deferred (R-5.2.d).
- **MQTT/soundbox / Clear — Partial:** `device_id` vs `mqtt_client_id` topic segment (Q15); TTL semantics (Q25).
- **MQTT/soundbox / Consistent — Partial:** topic identifier mismatch between §10.1 and §17.6.
- **MQTT/soundbox / Testable — Partial:** headless subscriber (R-5.2.c) makes the publish testable, but the *browser-speaks* acceptance (the actual demo) is untestable until autoplay/auth are resolved.
- **MQTT/soundbox / Feasible — Fail:** as written, a passive browser tab may neither authenticate to IoT Core nor be permitted to speak — the two unresolved blockers directly threaten the demo's headline moment.
- **MQTT/soundbox / Uniquely ID — Fail:** no source IDs.

- **Reporting / Complete — Partial:** aggregations, grouping, and API/CLI shape unspecified (fine for R2).
- **Reporting / Clear — Partial:** "daily sales / transaction list" without fields or time-zone handling.
- **Reporting / Testable — Partial:** no expected totals defined.
- **Reporting / Uniquely ID — Fail:** no source IDs.

> **Uniquely-Identifiable is Fail across the board** because neither source document assigns requirement IDs. This review supplies the `R-a.b.x` scheme; adopting it (and keeping it in the ADRs) closes that column.

---

## 7. Top risks and recommendations

1. **Soundbox feasibility is the #1 demo risk (MQTT/soundbox / Feasible = Fail).** Browser→IoT-Core WS auth (SigV4/Cognito) and Web-Speech autoplay are both unresolved and both can silently kill the headline moment. *Next step:* spike a bare "browser subscribes to IoT Core over WS + speaks on message" before any other build; decide Cognito Identity Pool vs custom authorizer and an "Enable audio" gesture. (Q16, Q17)
2. **Webhook/ledger is the highest-value and least-complete area (Complete = Fail, Consistent = Fail).** Idempotency key, append-vs-mutate ledger, and signature-in/out are all undefined and mutually entangled. *Next step:* one ADR settling Q3, Q4, Q23 before Phase 2 (D6) starts; implement idempotency as **conditional DynamoDB writes** keyed on `provider_transaction_id`, signature verification explicitly deferred.
3. **TIMEOUT has no defined behaviour, yet it's one of four first-class mock outcomes (Function / Blocking).** No poller/sweeper exists in the D6 phase list. *Next step:* decide Q8/Q9 — recommend a minimal EventBridge-Scheduler sweeper in the MVP that marks stuck payments EXPIRED, so all four mock outcomes are demonstrable.
4. **Non-SUCCESS portal + soundbox states are unspecified (Payment initiation & Portal).** The demo is happy-path only; FAILED/EXPIRED leave the payer on "pending" forever. *Next step:* product owner defines terminal-state copy and a client poll timeout (Q10, Q24, R-3.3.b).
5. **"Ledger" and the DynamoDB data model are undefined open decisions (Structure/Data / Blocking).** Single-table vs per-domain, mutable payment vs append-only events, and the S3/`payment_events`/EventBridge relationship all block Task 4.3. *Next step:* data-model ADR (Q2, Q3, Q6) — this is a prerequisite for the very first code phase.
6. **Device binding replaces an out-of-scope pairing ceremony with nothing (Operations).** The webhook's merchant→device lookup needs a binding path that D-decisions never define. *Next step:* define an Operator seed/`/pair` bind (Q20), 1 merchant→1 device for the PoC.
7. **The demo's critical-path architecture (direct publish vs EventBridge) is ambiguous (Structure / Blocking).** It changes where idempotency and announce-once live and whether the loop stays under 5 s. *Next step:* decide Q1 — recommend **direct** webhook→ledger→IoT for the MVP, EventBridge fan-out in R2.

**Questions that block implementation planning (answer before Phase 2):** Q1 (event path), Q2 (table model), Q3 (ledger semantics), Q4 (idempotency key), Q8 + Q9 (TIMEOUT + sweeper), Q16 (IoT browser auth). Q17, Q13/Q14, Q20, Q21, Q23 are High and should be answered before their respective phases but do not block the overall plan.
