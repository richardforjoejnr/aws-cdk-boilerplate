# CLAUDE.md — Ghana Payments PoC

Guidance for Claude Code when working in `packages/ghana-payments`.

## What this is

An AWS serverless PoC of a digital payment orchestration + soundbox (audio payment confirmation) platform for Ghanaian street vendors. **Read `docs/concept.md` before planning or designing anything here** — it is the authoritative spec (goals, personas, API design, data model, MQTT topics, MTN MoMo integration details, fraud controls, MVP scope).

## Current phase: planning

- Planning artifacts belong in `docs/planning/` (scope, ADRs, implementation plan, test strategy). Persist agent planning outputs there.
- Open decisions are tracked in `docs/planning/README.md` — resolve them explicitly (record as ADRs) rather than assuming.
- No infrastructure exists yet. When it's time, add a `GhanaPaymentsStack` in `packages/infrastructure/lib/` following the `JiraDashboardStack` precedent, and wire it in `bin/app.ts`. Do not deploy anything for this project until an implementation plan is agreed.

## PoC constraints (differ from the concept's production design)

- Serverless, not containers: Lambda + API Gateway + DynamoDB + EventBridge + AWS IoT Core (MQTT) + S3 + SNS. See the mapping table in `README.md`.
- Provider integrations start with a `SIMULATED` adapter behind a common provider interface; MTN MoMo **sandbox** (concept §17) is the first real integration. Never wire production payment credentials in this repo.
- Soundbox is a virtual device for the PoC: an MQTT subscriber (CLI or web page) on AWS IoT Core using the topic design in concept §10.1.
- Money amounts: store as integer pesewas (minor units) in DynamoDB, not floats.

## Conventions

- Follows repo-wide conventions (root `CLAUDE.md`): TypeScript strict, ES Modules, Node.js 20.x Lambdas, stage-prefixed resource names (`{stage}-ghana-*`), standard tags.
- Domain code lives under `src/{domain}/` — merchant, qr, payments, webhooks, devices, notifications. Shared types in `src/shared/types.ts` (statuses and event schemas come from concept §9/§20 — extend there, don't redefine locally).
- Webhook handling must be idempotent and record raw payloads before processing (concept Appendix B). This is a core correctness requirement, even in the PoC.
- Treat `ghana_card` numbers, wallet numbers, and MSISDNs as sensitive: tokenize/hash, never log in plaintext.
