# Observability & Monitoring — plan

A monitoring surface for the POC that (a) proves value — transactions, volume per
merchant/soundbox, latency, network mix — and (b) makes failures traceable end to
end (merchant → service → device), so we know what to harden for production.

## What already exists (build on this)

The system emits most of the raw signal already:

| Signal | Where | Use |
|---|---|---|
| **Per-payment lifecycle** | `payments` table `EVT#<iso>#<id>` rows (`appendEvent`) | flow trace + latency (INITIATED → CONFIRMED/FAILED → ANNOUNCEMENT_PUBLISHED) |
| **Service events** | EventBridge `payment.*`, `wallet.*` + `audit-writer` → audit table | seams for aggregation |
| **Device heartbeat** | IoT rule `devices/+/heartbeat` → `status-updater` | last_seen, battery (and `signal`, currently dropped) |
| **Device ACK** | soundbox publishes `{status:'played', payment_id}` | confirmed→played latency; unplayed detection |
| **Status/merchant indexes** | payments GSI1 (merchant_id), GSI2 (status) | query by merchant / failed |
| **DLQs** | mock-callbacks-dlq, announcer-dlq | failure backlog |
| **Cost** | `/v1/costs` (Cost Explorer) | spend footer |

Gaps: unstructured error logs (no correlation IDs), no metrics/latency aggregation,
no network-type capture, no telemetry history, no monitoring page.

## What to track

**1. Flow trace (traceable by merchant / device / payment).** Correlation id =
`payment_id`; enrich every event with `merchant_id` + `device_id`:
`INITIATED → WALLET_DEBITED → PROVIDER_CALLED → CALLBACK_RECEIVED → CONFIRMED →
ANNOUNCEMENT_PUBLISHED → DEVICE_PLAYED`, timestamped → per-stage latency + where it
stalls/fails.

**2. Errors & failures.** Business (INSUFFICIENT_FUNDS, PROVIDER_TIMEOUT, DECLINED,
EXPIRED, LATE/duplicate callback) and system (Lambda errors, DLQ depth, IoT publish
failure, provisioning rejects, webhook parse fails) — all with correlation ids.

**3. Usage / value.** Transactions & GHS volume — total, **per merchant**, **per
soundbox**, per network, per day/hour; success rate; avg ticket; active
merchants/devices; announcements delivered vs played.

**4. Latency.** End-to-end (initiated→confirmed), provider (called→callback),
announce (confirmed→published), delivery (published→played), API (API GW native).

**5. Device & network.** Online/offline, battery, **network_type (WIFI/4G/3G/2G)**,
RSSI, operator, reconnects — correlate connectivity with failures/latency per
merchant location.

## How to capture it (cost-aware)

1. **Structured JSON logging + correlation IDs** (foundation, ~free). A shared
   `log()` emitting `{request_id, payment_id, merchant_id, device_id, service,
   level, msg}`; replace ad-hoc `console.*`. Makes Logs Insights trace any entity
   across services. Retention 14 days.

2. **CloudWatch EMF metrics — LOW-cardinality dimensions only** (the key cost
   decision). Emit `TransactionCount`, `TransactionAmountPesewas`,
   `PaymentLatencyMs`, `AnnounceLatencyMs`, `ProviderLatencyMs`, `ErrorCount` with
   dims `network_type` / `status` / `service` / `error_code` (each a handful of
   values). **Never** put `merchant_id`/`device_id` as a metric dimension — that is
   the #1 CloudWatch cost trap (each unique combo = a paid custom metric).

3. **Per-merchant / per-device aggregates → DynamoDB counters, not CloudWatch.**
   Rollup rows (`STATS#<merchant_id>#<date>`, `STATS#DEV#<device_id>#<date>`) with
   atomic `ADD` on count/volume, updated from the existing `audit-writer`/announcer.
   High-cardinality is free here; reads are ms + pennies.

4. **Network telemetry → extend the heartbeat path.** Add `network_type`, `rssi`,
   `operator` to the heartbeat payload (firmware; the simulator gets a `--network`
   flag). Extend the IoT rule + `status-updater` to also write a **time-series**
   `telemetry` row (`device_id` PK, `ts` SK, TTL 30d) → connectivity history, cheap.

5. **Latency** computed from the `EVT#` timestamps in the confirm/announce handlers,
   emitted as EMF (low-cardinality); per-txn detail stays in the ledger for the
   trace view.

6. **X-Ray** (infra distributed tracing) — **skip for POC** (the ledger already
   gives business-level tracing); revisit for production.

## How to surface it — the monitoring page

A new **"Observability" tab in the admin portal** backed by admin read APIs, plus a
CloudWatch dashboard for infra ops. Three views:

- **Overview (value):** today/7d transactions, GHS volume, success rate, active
  merchants/devices, avg ticket; charts of volume over time, by network_type, top
  merchants, announced-vs-played. Source: DynamoDB stats + EMF (GetMetricData).
- **Flow trace / errors (debug):** search by merchant/device/`payment_id` → the
  ordered lifecycle timeline with per-stage latency and failures highlighted (EVT#
  ledger); recent-failures feed (GSI2 status=FAILED, DLQ) with the correlation id;
  deep error detail via Logs Insights on demand.
- **Fleet / network health:** devices online/offline, battery, network_type mix,
  RSSI, reconnects, last-seen; device failures correlated with network. Source:
  devices + telemetry tables.

New admin endpoints: `/v1/observability/overview`, `/trace/{payment_id}`,
`/failures`, `/fleet`. Reuse admin API-key auth.

Complement with a **CloudWatch Dashboard** (DLQ depth, Lambda errors/duration, API
5xx, latency) for on-call — cheapest ops view.

## Phased delivery (each phase independently useful)

| Phase | Scope | Effort |
|---|---|---|
| **0** | Structured logging + correlation IDs; enrich EVT# with merchant/device | 0.5–1 d |
| **1** | EMF metrics (low-card) + DynamoDB stats rollups + latency; CloudWatch dashboard | 1–2 d |
| **2** | Observability read APIs + portal page (overview + trace + failures) | 2–3 d |
| **3** | Heartbeat network fields + telemetry table + fleet health view (firmware-dependent; simulate for POC) | 1–2 d |
| **4** (opt) | CloudWatch Alarms (DLQ/error-rate/latency → SNS/Slack); X-Ray | 0.5–1 d |

## Costs (POC scale, us-east-1)

Assume ~thousands of txns/month, a handful of devices.

| Item | Driver | POC estimate |
|---|---|---|
| CloudWatch Logs | $0.50/GB in, $0.03/GB-mo | **<$1/mo** (14-day retention) |
| Custom metrics (EMF) | $0.30/metric-mo, low-card only | **$1–3/mo** |
| Logs Insights | $0.005/GB scanned | pennies |
| Dashboard | $3/mo after first 3 free | **$0** |
| DynamoDB stats + telemetry | pay-per-request, TTL'd | **<$1/mo** |
| X-Ray / Alarms (if added) | 100k traces free / $0.10 alarm | **<$1/mo** |
| **Total** | | **≈ $3–8 / month** |

**Biggest cost risk:** high-cardinality CloudWatch custom metrics — a fleet of
thousands with per-merchant/device metric dimensions turns $3 into hundreds. The
design avoids it by keeping high-cardinality aggregation in DynamoDB counters.

**Production evolution:** at millions of txns / thousands of merchants, move
high-cardinality analytics off CloudWatch onto a pipeline — ledger/EventBridge →
Kinesis Firehose → S3 → Athena/QuickSight (and OpenSearch for log search). Cheap
per-GB, unlimited cardinality. The POC's DynamoDB-counter approach is right for now.

## Recommended starting point

Phases 0–1 give immediate value for little effort and near-zero cost: traceable
logs, a latency/volume/error dashboard, and per-merchant/device stats — enough to
demonstrate POC value and catch problems. Phase 2 (the in-portal page) is the
"show-value" deliverable; Phase 3 adds the network story once real hardware reports
its RAT.
