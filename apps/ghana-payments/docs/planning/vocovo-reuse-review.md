# Vocovo Estate Review — Reusable Patterns for the Ghana Payments PoC

Reviewed 2026-07-11. Repos at `~/Documents/Vocovo/`: `portal-client`, `vortal-server`, `VocoMQBroker`, `cloud-hivemq-ce-broker`, `cloud-hivemq-enterprise-broker`. Vocovo runs a production system with the same shape as our PoC: cloud backend ↔ MQTT broker ↔ fleet of audio devices (controllers), with a web portal.

> **Reuse patterns and lessons, not code.** These are employer repos; the PoC borrows design decisions and hard-won operational lessons only.

## What each repo is

| Repo | Stack | Role |
| --- | --- | --- |
| `portal-client` | React, FeathersJS + Socket.io client | Web portal. **No MQTT in the browser** — real-time updates arrive via Socket.io channels from vortal. |
| `vortal-server` | Node/TypeScript, FeathersJS, Postgres/Sequelize, Redis, `mqtt` client | Backend; bridges MQTT device traffic to portal Socket.io, request/response to devices, heartbeat/liveness. |
| `VocoMQBroker` | Node, Aedes + Redis persistence | **Legacy** self-built broker (clientId+password auth in Redis, custom topic ACLs, payload validation). Being replaced. |
| `cloud-hivemq-ce-broker` / `-enterprise-broker` | HiveMQ + Helm/K8s (Azure AKS), custom auth extension + external MQTT auth service | The replacement: managed-grade third-party broker. CE in dev envs, Enterprise (licensed) in prod. |

## Lessons to adopt

### 1. Topic design: per-device topics both directions — never a shared funnel topic ⛔

Vocovo's legacy design funnels **all** device→cloud traffic onto a single `vortal` topic. Their own docs record the consequences: the broker can't ACL by topic, so it must **validate payloads** to stop devices impersonating each other (`source`/`publisher` checks); new consumers (reporting service) had to piggyback on the same topic; routing lives in payload `type` fields instead of the topic tree. Their newer "Sparkplug-like" scheme (`controller/{serial}/{message_type}/{node}`) exists precisely to escape this.

**PoC rule (per Richard):** stick with concept §10.1 per-device topics in both directions — `devices/{device_id}/payments|commands|config|heartbeat` — and put the message type in the topic, not only the payload. On AWS IoT Core this also unlocks lesson 3.

### 2. QoS and session lessons (`VocoMQBroker/docs/subscribers.md`)

- Publish payment announcements at **QoS 1**; subscribers use **persistent sessions** (`clean: false` / MQTT5 session expiry) so announcements missed while offline are delivered on reconnect — this directly implements concept §15 "offline tolerance" and §17.8 "device offline" handling.
- Retained messages ≠ persistent sessions: retained = "latest state on subscribe" (good for `config`), persistent session = "missed messages replayed" (right for `payments`).
- **AWS IoT Core specifics:** QoS 2 is not supported (Vocovo recommends QoS 2; on IoT Core the ceiling is QoS 1 — fine, our announce payload has idempotent semantics + `ttl_seconds`). Persistent sessions expire after a default ~1 hour disconnect; acceptable for the PoC, note it in the demo script.

### 3. Device identity: broker-enforced, not payload-enforced

VocoMQBroker uses clientId+password with a trust-on-first-use registration window in Redis, and their docs admit **passwords are never rotated** — a known weakness, and the whole reason payload validation exists.

**PoC:** use IoT Core's native model instead — one X.509 cert per device (or Cognito identity for the browser sim), with an IoT policy using `${iot:Connection.Thing.ThingName}` / `${iot:ClientId}` variables so a device can only pub/sub its own `devices/{device_id}/…` topics. Impersonation is impossible at the broker; no payload validation layer needed. The concept §10.2 pairing-token flow becomes "bind cert/identity to merchant in the device registry."

### 4. Client ID uniqueness

`vortal-server` hard-fails startup without a per-instance clientId suffix: *"instances sharing a client ID evict each other from the broker."* Identical behaviour on IoT Core (new connection with same clientId disconnects the old). The browser soundbox page, the headless Node test subscriber, and any second browser tab must each use distinct client IDs (e.g. `soundbox-{device_id}-{random}`), while topic authorization keys off the device identity, not the client ID.

### 5. Reconnect discipline

vortal subscribes **inside every `connect` event** (not once at startup), and deliberately never gates resubscription on other infrastructure writes (a Redis blip must not leave the client "connected but subscribed to nothing"). Copy this into the soundbox sim and test subscriber: (re)subscribe on every connect, fire-and-forget any status reporting.

### 6. Presence/liveness: let IoT Core do what vortal built by hand

vortal implements per-pod liveness keys in Redis with TTL + a watcher aggregating them into "is device traffic flowing" events. On AWS, IoT Core **lifecycle events** (`$aws/events/presence/connected|disconnected/{clientId}`) give device presence for free — route them to a Lambda that flips device status ACTIVE/OFFLINE (concept §20 statuses). Keep the concept's application-level heartbeat topic for battery/signal, but don't build presence plumbing.

### 7. Request/response over MQTT (`controllerRequestResponse.ts`)

Clean pattern worth mirroring for the `devices/{id}/commands` topic (test announcement, volume): correlation-id per request, callback map, explicit timeout with distinct SUCCESS / TIMEOUT / ERROR event types, and an audit-log entry per request. For the PoC a simplified Lambda + DynamoDB-correlation version is enough, but keep the three-outcome vocabulary.

### 8. Browser real-time: two viable designs, decide in the soundbox spike

Vocovo deliberately does **not** put MQTT in the browser — portal-client gets real-time via Socket.io, with vortal as the MQTT↔web bridge. For our browser soundbox this legitimizes two options:

- **(a) Direct:** browser connects to IoT Core over MQTT-WSS (needs Cognito identity pool / SigV4 — the open auth question, requirements review Q16).
- **(b) Bridge (Vocovo pattern):** the soundbox page talks to an API Gateway WebSocket API; a Lambda fans payment events out to connected pages. Simpler auth, but it demos "a web page" rather than "an MQTT device," and the headless MQTT test subscriber then exercises a different path than the demo.

Recommendation: spike (a) first — it's more faithful to the soundbox story; fall back to (b) if IoT browser auth burns more than a day.

### 9. Build vs buy the broker — settled by Vocovo's own history

Vocovo built a broker (Aedes + Redis) and is actively migrating off it to HiveMQ, with auth pushed to an external service/extension. Their broker code carries rate-limiting for reconnect thundering herds, Redis persistence tuning, clientId translation hacks — all things a managed broker absorbs. **For the PoC: AWS IoT Core, no self-hosted broker.** (If post-PoC parity with work infra ever matters, the HiveMQ repos show exactly how to run CE via Helm — but that drags in a container platform the PoC doesn't need.)

### 10. Testing/process habits worth stealing

- vortal blocks all outbound HTTP in unit tests (`mitm`) — forces proper client mocking; great fit for our provider-adapter contract-test story.
- Broker behaviours (auth, ACL, duplicate delivery) are covered by dedicated integration tests against a real broker in `VocoMQBroker/integration-tests` — mirror this with integration tests against IoT Core (or a local broker in CI).
- Runbook-style markdown docs per risky operation (`BROKERCONNECTION_DEV_TEST_RUNBOOK.md`) — adopt for the demo script and device-pairing flow.

## Explicit anti-patterns (do not carry over)

1. **Single shared uplink topic** (`vortal`) with payload-based sender validation — ruled out (Richard, 2026-07-11).
2. **TOFU password registration with no rotation** — superseded by IoT Core cert/identity binding.
3. **ClientId translation hacks** for multi-team broker sharing — irrelevant at PoC scale; stage-prefixed resources already isolate environments.
4. **Message-type-only-in-payload routing** — put message type in the topic path.
