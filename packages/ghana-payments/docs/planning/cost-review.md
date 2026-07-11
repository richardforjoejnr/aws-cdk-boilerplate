# Cost Review — Ghana Payments PoC

Estimates for us-east-1 list prices as of mid-2026; always sanity-check against current pricing. All figures exclude the always-free tiers first, then note where free tier makes it $0 in practice. Everything is pay-per-use — **there are no always-on servers anywhere in this design**, so idle cost is close to zero by construction.

## 1. Per-transaction cost (the D5 demo loop)

One full loop = QR resolve → initiate → ~8 status polls → mock callback via SQS → webhook → ledger writes → 5 bus events → fan-out Lambdas → IoT publish → announcement ack.

| Service | Units per txn | Rate | Cost |
| --- | --- | --- | --- |
| API Gateway (REST) | ~12 requests (polls dominate) | $3.50/M | $0.000042 |
| Lambda | ~10 invocations, ~150 ms @ 256 MB | $0.20/M + $0.0000167/GB-s | $0.000008 |
| DynamoDB (on-demand) | ~12 writes, ~25 reads | $0.625/M W, $0.125/M R | $0.000011 |
| EventBridge | ~5 custom events | $1.00/M | $0.000005 |
| SQS (mock delay queue) | ~2 messages | $0.40/M | $0.000001 |
| IoT Core messaging | ~3 messages | $1.00/M | $0.000003 |
| S3 (webhook inbox PUT) | 1 PUT | $5.00/M | $0.000005 |
| **Total** | | | **≈ $0.000075 ≈ 0.0075¢** |

**≈ $0.08 per 1,000 transactions.** A demo day with 500 scans costs about **4 cents**. API Gateway polling is the biggest slice — worth knowing, not worth optimizing at PoC scale (see §4).

## 2. Idle / per-day running cost

| Item | Driver | Cost/day |
| --- | --- | --- |
| Sweeper Lambda (1/min) | 1,440 invocations + GSI2 query | ~$0.001 (fully inside Lambda free tier in practice) |
| Soundbox connected 24 h | IoT connectivity $0.08/M conn-min → 1,440 min | ~$0.0001 |
| DynamoDB storage | MBs of data | ~$0 |
| CloudWatch log ingestion | the only real variable — keep the sweeper quiet | $0.01–0.04 |
| Everything else (SSM standard, Cognito identity pool, EventBridge bus, S3 storage) | | $0 |
| **Idle total** | | **≈ $0.01–0.05/day (≈ $1/month)** |

## 3. Fixed monthly + monitoring cost

| Item | Rate | PoC cost |
| --- | --- | --- |
| CloudWatch dashboard | first 3 free, then $3/mo | **$0** (this is dashboard #1–3 in the account) |
| CloudWatch alarms (~8: DLQs, errors, sweeper) | first 10 free, then $0.10/mo | **$0** |
| CloudWatch Logs | $0.50/GB ingest + $0.03/GB-mo stored | **< $0.50/mo** with 7-day dev retention (set retention explicitly on every log group — the classic silent cost) |
| X-Ray | 100k traces/mo free, then $5/M | **$0** with 10% sampling |
| AWS Budgets alarm ($20 guard) | free | $0 |
| CloudFront | 1 TB + 10M requests/mo always-free | **$0** at PoC traffic |
| **Total monthly (idle + fixed + a few demo days)** | | **≈ $1–3/month, worst case < $5** |

Cost visibility: all resources carry the standard `Project`/`Environment` tags, so Cost Explorer filtered on `Project` (or the existing `get-costs` Lambda pattern) gives per-project spend; the Budgets alarm emails at $20. Teardown to literal $0 any time via `npm run ghana:destroy:dev`.

## 4. Scale sanity check (not PoC — pilot per concept §15, 10k merchants ≈ 3M txns/mo)

| Service | Est./month |
| --- | --- |
| API Gateway (~36M requests — polling dominates) | ~$125 |
| DynamoDB | ~$35 |
| IoT Core (10k devices always-connected + messages) | ~$40 |
| Lambda | ~$25 |
| EventBridge | ~$15 |
| CloudWatch logs (disciplined) | ~$30 |
| **Total** | **≈ $250–350/mo ≈ $0.0001/transaction** |

Two notes for that future: replace portal polling (8–10 polls/txn) with SSE/WebSocket or switch to HTTP APIs ($1.00/M) — that alone cuts the biggest line ~70%; and IoT connection-minutes become the floor cost of a large always-on device fleet. Neither matters at PoC scale.

## 5. Cost risks & guards

1. **Log ingestion** is the only line that can surprise — guard: explicit 7-day retention + no per-poll INFO logging + the Budgets alarm.
2. **Forgotten deployed stack** — guard: everything destroyable (`ghana:destroy:dev`, destroy workflow), idle cost ~$1/mo even if forgotten.
3. **Runaway Lambda loop** (e.g. webhook → event → webhook) — guard: no Lambda publishes to an endpoint that triggers itself; DLQs + alarms catch retry storms.
4. **PROVISIONED billing on prod-like stages** — the foundation stack uses PAY_PER_REQUEST for all stages deliberately (PoC); revisit only if a pilot ever needs test/prod.
