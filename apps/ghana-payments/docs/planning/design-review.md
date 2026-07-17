# Design & Plan Review — Senior DevOps / AWS Solutions Architect pass

Reviewed 2026-07-11 against `architecture.md`, `poc-decisions.md`, `requirements-review.md`. Question asked: **is this good enough for a PoC?**

## Verdict

**Yes — sound and buildable, no architectural rework needed.** The risky unknowns are correctly front-loaded (Phase 0 spike), idempotency is designed as conditional writes rather than hope, and the provider seam means the mock proves the same code path production would use. Six findings below were worth fixing before build; the amendments have been applied to `architecture.md`. One scope observation and a cost/effort estimate close the review.

The design is, if anything, slightly **over-scoped for a PoC** — settlement recorder, audit writer, and notification stub don't change what the demo proves. They're kept because full layer coverage was an explicit requirement (D9), but they're the correct cut line if time pressure hits: **Phases 0–4 are the PoC; Phase 5 is polish.**

## Internet accessibility (explicit requirement check)

Confirmed by design, with one improvement (F-4): everything a phone or laptop touches is public —

- **Portals** (payment, merchant, soundbox): S3 behind CloudFront — public HTTPS by default.
- **API Gateway**: regional **public** endpoint; no VPC, no private links anywhere in the design.
- **QR codes** encode the CloudFront URL, which is stable across redeploys — printed badges don't go stale.
- **IoT Core** MQTT-WSS endpoint is public (auth via Cognito identity).
- Admin surfaces are public-but-keyed (see F-5), which is the right PoC trade-off.

## Findings (severity-ordered, all amendments applied)

### F-1 · Correctness — sweeper vs late-callback race *(high)*
`TIMEOUT_AMOUNT` payments are expired by the sweeper and the wallet credited back. If the mock (or later, MTN) delivers a late SUCCESS callback afterwards, a naive status write would mark an already-refunded payment SUCCESS — and announce it. **Fix:** the payment state machine gains terminal states — EXPIRED/FAILED/SUCCESS are absorbing; the ledger's conditional update rejects transitions out of them; a late callback is recorded as an `EVT#…ANOMALY_LATE_CALLBACK` item and publishes nothing. This must be an explicit Phase 2 test case.

### F-2 · Reliability — mock callback delivery mechanism *(medium)*
"Lambda self-invoke or Step Functions wait" was underspecified; a sleeping Lambda is waste and self-invoke retries poorly. **Fix:** the mock enqueues to an SQS queue with per-message `DelaySeconds` (2–3 s); a small delivery Lambda then **POSTs over HTTPS to the real public webhook URL** — exercising API Gateway, throttling, and the receiver exactly as an external provider would. DLQ on the queue covers delivery failure.

### F-3 · Correctness — announce-once must also exist device-side *(medium)*
ADR-4b guards the backend publish, but MQTT QoS 1 permits broker redelivery to the device. The concept's ESP32 sample (§17.7) has no dedupe. **Fix:** the device contract (browser sim + headless subscriber, and future firmware) dedupes announcements by `payment_id` with a short LRU. Cheap, and it makes the automated "speaks exactly once" assertion honest.

### F-4 · Architecture — put CloudFront in front of API Gateway too *(medium, simplification)*
Portals on `xxxx.cloudfront.net` calling `yyyy.execute-api…` is a cross-origin setup: CORS preflights on every endpoint, two public hostnames, and a classic PoC time-sink. **Fix:** add an `/api/*` behavior on the same CloudFront distribution routing to API Gateway. One public domain, **zero CORS**, one URL in `PUBLIC_BASE_URL`, and CloudFront's default WAF-lite posture in front of the API for free. (Webhook path included — the mock's delivery Lambda calls the same public URL.)

### F-5 · Security — admin API key ships in static JS *(accepted risk, documented)*
The merchant portal is a static site; its API key is visible to anyone who views source. Impact in a dev-only simulation: a stranger could create/remove fake merchants. Accepted for the PoC; mitigations if it ever matters before Cognito lands: a CloudFront Function basic-auth check on `/admin/*`, or key rotation via usage-plan swap. Production path (Cognito + RBAC) already recorded in §6.

### F-6 · Spike scope — Cognito↔IoT has three known sharp edges *(medium, informational)*
So the Phase 0 spike tests the right things: (1) unauthenticated Cognito identities need an IoT policy **attached per identity** (`iot:AttachPolicy`) — in this design the pairing Lambda does it as part of §10.2; (2) the policy's `iot:Connect` clientId pattern must accommodate the sim's random client IDs while topic permissions stay scoped to the paired `device_id`; (3) browser persistent sessions won't survive a page reload (new identity → new session), so offline-recovery testing belongs to the headless subscriber, not the browser. None of these are blockers; all three are why the spike exists.

## DevOps assessment

| Area | Assessment |
| --- | --- |
| Deployability | ✅ `cdk-deployer` verified with sufficient IAM; CDK bootstrap already done; stack follows the JiraDashboard precedent incl. dedicated deploy/destroy scripts; everything stage-prefixed and PR-preview-safe; dev uses DESTROY removal policy — clean teardown. |
| Observability | ✅ Structured logs, X-Ray, CloudWatch dashboard, DLQ alarms specified. Adequate for PoC. |
| Cost | ✅ Estimated **< $5/month** at demo traffic (Lambda/DynamoDB/EventBridge/IoT all pay-per-use; CloudFront pennies). Amendment: add an **AWS Budgets alarm (~$20)** to the stack — this is a personal account. |
| CI/CD | ✅ Existing `ci.yml` covers build/lint/test for the workspace; deploys manual via scripts — right weight for a PoC. |
| Secrets | ✅ None needed until the MTN sandbox adapter; SSM parameters for config. Existing repo guidance on credential rotation applies. |
| Rollback | ✅ Stateless Lambdas + additive DynamoDB schema; `cdk deploy` of previous commit suffices. |

## Effort estimate (focused days)

| Phase | Est. |
| --- | --- |
| 0 Spike | 0.5–1 |
| 1 Foundation | 1–2 |
| 2 Payment core | 2–3 |
| 3 QR + portals | 2–3 |
| 4 Device + soundbox | 2–3 |
| 5 Settlement/reporting/ops | 1–2 |
| **Total** | **~9–14 days** (Phases 0–4 alone: ~8–12) |

## Readiness checklist — do we have everything?

- [x] Requirements + scope agreed (concept, D1–D9, requirements review)
- [x] All architecture decisions made (ADR-1..10); only ADR-6 direct-vs-bridge awaits spike evidence
- [x] AWS account, region, bootstrap, deployer permissions verified
- [x] Repo conventions, package skeleton, shared types in place
- [x] Internet-public access confirmed by design
- [ ] Phase 0 spike result (only remaining unknown)
- [ ] Test strategy doc (`test-strategy.md`) — recommended before Phase 2, not blocking Phase 0/1

**Nothing else is needed from outside. Ready to build.**
