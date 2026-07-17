# Phase 0 Spike Results — Browser → IoT Core MQTT-WSS (ADR-6)

Run 2026-07-11 against `dev-ghana-payments-spike` (throwaway stack, gated behind `DEPLOY_GHANA_SPIKE=true`).

## Result: ADR-6 direct connection CONFIRMED — including browser speech ✅

Browser test confirmed by Richard (2026-07-11): tab connected over MQTT-WSS, **spoke "Payment received, 20 Ghana cedis" aloud via Web Speech**, and correctly ignored a duplicate publish with the same `payment_id` (F-3 dedupe). Reload behaviour as designed: cached identity reused, fresh clean session (no replay — expected; catch-up is the headless/real device's job).

Verified end-to-end with the headless client (`spike/node-client.mjs`):

```
[1] Cognito identity: us-east-1:c43c2220-793d-...
[2] AttachPolicy: HTTP 200 {"attached":true,...}
[3] Got temporary AWS credentials
[4] MQTT connected over WSS as spike-node-c47dd148
[5] Subscribed to spike/announce (QoS 1)
[6] RECEIVED: {"message":"Payment received, 20 Ghana cedis"}
[7] Ack published to spike/ack — spike auth path VERIFIED
```

## F-6 sharp edges — outcomes

1. **Per-identity `iot:AttachPolicy`** — works exactly as designed: a Lambda (function URL, standing in for the pairing Lambda) attaches the IoT policy to the Cognito identityId; connection succeeds immediately after. Both layers were required as expected (unauth IAM role **and** attached IoT policy).
2. **ClientId pattern** — policy `client/spike-*` with random suffixed client IDs (`spike-node-…`, `spike-web-…`) works; scoping connect by prefix while scoping topics separately is viable for `devices/{device_id}/*` in Phase 4.
3. **Reload/session** — browser page caches identityId in localStorage so the policy attachment survives reloads; sessions don't (clean start per load). Offline catch-up testing stays with the headless subscriber, as planned.

## Implementation notes for Phase 4 (keep)

- **Function URL CORS gotcha (cost us one round-trip):** when a Lambda Function URL has CORS configured, the function must NOT emit its own `Access-Control-*` headers — the service appends its own and browsers reject the duplicated `Allow-Origin` ("multiple values '*, http://localhost:8642'"). Applies to the real pairing endpoint too (API Gateway CORS + handler headers = same failure mode).

- SigV4 presigner for `iotdevicegateway` implemented twice: Node (`spike/node-client.mjs`, node:crypto) and browser (`spike/browser/index.html`, Web Crypto) — both work; lift into `src/devices/` when building the real sim.
- Cognito unauth flow needs **no SDK in the browser** — two plain `fetch` calls (`GetId`, `GetCredentialsForIdentity`) suffice.
- Device-side dedupe by `payment_id` (F-3) is implemented in the spike page as the reference pattern.
- mqtt.js v5 `mqtt.min.js` works in-browser against IoT Core with `protocolVersion: 4`.

## Decision

**ADR-6 stands: direct browser → IoT Core over MQTT-WSS with Cognito identity + pairing-time AttachPolicy. The API Gateway WebSocket fallback is not needed.**

Teardown when done: `cd packages/infrastructure && DEPLOY_GHANA_SPIKE=true STAGE=dev npx cdk destroy dev-ghana-payments-spike --force`
