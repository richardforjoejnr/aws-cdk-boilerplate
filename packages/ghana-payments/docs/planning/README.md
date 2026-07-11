# Planning Workspace

Planning artifacts for the Ghana Payments PoC live here. Source of truth for requirements is [`../concept.md`](../concept.md).

## Expected artifacts

| File | Purpose | Status |
| --- | --- | --- |
| `poc-decisions.md` | Decisions locked in from the initial design discussion (mock provider, QR portal, browser soundbox, phases) | DONE |
| `requirements-review.md` | Requirements-analyst output: story map, gaps, clarifying questions | DONE |
| `vocovo-reuse-review.md` | Patterns/lessons from Vocovo's production MQTT-device estate (topics, QoS, device auth, browser real-time) | DONE |
| `architecture.md` | **PoC target architecture**: AWS design, ADR-1..10, API domains, integration model, data design, security controls, deployment, roadmap | DONE |
| `design-review.md` | Senior DevOps/SA review: verdict, findings F-1..F-6 (amendments applied), effort estimate, readiness checklist | DONE |
| `cost-review.md` | Running/per-day/per-transaction/monitoring costs + scale sanity check | DONE |
| `test-strategy.md` | Risk-based test approach for payment/webhook/device flows | TODO (use the `ghana-test-designer` agent) |

## Project agents

Committed in `.claude/agents/` — Claude Code auto-delegates by description, or invoke by name:

- **ghana-architect** — design conformance vs ADRs before each phase (read-only)
- **ghana-code-reviewer** — diff review against PoC invariants (idempotency, terminal states, pesewas, per-device topics) (read-only)
- **ghana-test-designer** — risk-based test case design per phase (read-only)
- **ghana-devops** — deploy/destroy/health/cost operations via the repo scripts
- **ghana-verifier** — runs everything end-to-end against deployed dev and fixes failures (the only one that edits)

## Deployment plumbing (live)

- Stack: `packages/infrastructure/lib/ghana-payments/foundation-stack.ts` (`{stage}-ghana-payments-foundation`) — wired in `bin/app.ts`, synth-verified
- Scripts: `scripts/deploy-ghana-payments.sh` / `destroy-ghana-payments.sh` (stack list in one place: `GHANA_STACKS`)
- npm: `ghana:deploy:{stage}` / `ghana:destroy:{stage}`
- CI/CD: `.github/workflows/ghana-payments-deploy.yml` (manual, stage choice) and `ghana-payments-destroy.yml` (requires typing DESTROY)

## Open decisions

Resolved (see `poc-decisions.md` for detail):

- ~~Provider integration~~ → **Mock adapter first** behind a `PaymentProvider` interface, MTN MoMo sandbox second; contract tests against both.
- ~~QR standard~~ → **Platform QR** encoding a URL to a hosted mock-wallet portal; GhQR deferred.
- ~~Soundbox connectivity~~ → **Browser simulator** over MQTT-WebSocket (AWS IoT Core) + headless Node subscriber for tests.
- ~~Settlement~~ → Out of scope for PoC beyond the ledger.

All previously-open questions are now resolved in `architecture.md` §2 (ADR-1..10): REST via API Gateway (ADR-10), DynamoDB table-per-domain (ADR-2), API-key auth for admin APIs (§6), S3/CloudFront portals with Cognito-identity IoT auth for the soundbox (ADR-6 — **pending the Phase 0 spike**, with the API Gateway WebSocket bridge as the fallback).

~~The only decision still contingent on evidence: ADR-6 direct-vs-bridge soundbox connectivity, settled by the Phase 0 spike.~~ **Settled 2026-07-11: Phase 0 spike PASSED including browser speech — direct IoT Core connection confirmed (`spike-results.md`).**

## Build status

- **Phase 0 (spike):** ✅ complete — ADR-6 confirmed, browser spoke, dedupe verified
- **Phase 1 (foundation):** ✅ deployed — `dev-ghana-payments-foundation` (tables, bus, inbox, SSM config)
- **Phase 2 (payment core):** ✅ deployed (`dev-ghana-payments-api`) and verified end-to-end against live dev — SUCCESS/FAILED(+credit-back)/DUPLICATE(one confirmation)/INSUFFICIENT_FUNDS paths, manual webhook replay → `duplicate:true`, audit trail populated, DLQs empty; 13 unit tests green. TIMEOUT/sweeper path verified separately.
- **Phase 3 (QR + portals):** ✅ deployed (`dev-ghana-payments-web`) and verified — QR API (generate/resolve/rotate/status, PNG output), payment portal `/pay/{qr_id}`, merchant portal `/admin`, all on one CloudFront domain with `/api/*` routed to API Gateway (F-4: zero CORS); full payment completed via the portal path; 18 unit tests green
- **Phase 4 (devices + soundbox):** ✅ deployed and verified — Device API with real §10.2 pairing (per-device IoT policies attached to Cognito identities), announcer with announce-once guard, heartbeat IoT rule (PAIRED→ACTIVE), hosted `/soundbox/` portal (MQTT-WSS + Web Speech + F-3 dedupe), admin portal device management + AWS cost footer. Headless sim verified the full D5 loop: pay → announced exactly once.
- **Phase 5 (reporting/ops polish):** remaining — reporting endpoints, CloudWatch dashboard, DLQ alarms, budget alarm, demo runbook

## How to plan with agents

From the repo root, useful flows:

- **Requirements review:** ask for a requirements review of `packages/ghana-payments/docs/concept.md` — the `requirements-analyst` agent produces a story map, gap analysis, and clarifying questions.
- **Architecture/implementation plan:** ask to plan the PoC implementation — the `Plan` agent designs the step-by-step build against this repo's CDK conventions.
- **Test planning:** the `context-driven-tester` agent can build a risk-based test plan for the payment/webhook/idempotency flows once scope is agreed.

Save agent outputs into this folder so they persist across sessions.
