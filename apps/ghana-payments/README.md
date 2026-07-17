# Ghana Payments — Street Vendor Digital Payment & Soundbox Platform (PoC)

AWS serverless proof-of-concept of a payment orchestration and soundbox notification platform for Ghanaian street vendors and micro-merchants.

- **Code tour (how it works, what's where):** [`docs/CODE_TOUR.md`](docs/CODE_TOUR.md)
- **Runbook (deploy/operate/destroy):** [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- **Concept spec:** [`docs/concept.md`](docs/concept.md) (markdown; original docx alongside it)
- **Planning artifacts:** [`docs/planning/`](docs/planning/)

## Package layout

One package for the whole PoC, organized by service domain so it can be split into separate packages later if needed:

```
packages/ghana-payments/
├── docs/
│   ├── concept.md                 # Authoritative spec (markdown)
│   ├── Expanded_Ghana_Digital_Payments_Concept.docx
│   └── planning/                  # PoC scope, ADRs, implementation plan
└── src/
    ├── shared/                    # Domain types, statuses, event schemas
    ├── merchant/                  # Merchant onboarding & profile (planned)
    ├── qr/                        # QR generation & resolution (planned)
    ├── payments/                  # Payment orchestrator + provider adapters (planned)
    ├── webhooks/                  # Provider callback receiver, idempotent event inbox (planned)
    ├── devices/                   # Soundbox registry, pairing, MQTT publish (planned)
    └── notifications/             # SMS/WhatsApp/push confirmations (planned)
```

## PoC mapping: concept architecture → this repo's serverless stack

The concept (§14) describes a container/Postgres/RabbitMQ deployment. The PoC maps it onto the serverless services already used in this repo:

| Concept component | PoC implementation |
| --- | --- |
| API Gateway + WAF | Amazon API Gateway (REST, matching the §8 API design) |
| Core services (containers) | Lambda functions per domain in `src/` |
| PostgreSQL | DynamoDB (single-table or per-domain tables — open decision) |
| Message broker (RabbitMQ/Kafka) | EventBridge for payment events; SQS for retries/DLQ |
| MQTT broker for soundboxes | AWS IoT Core (MQTT over TLS, per-device topics per §10.1) |
| Object storage for raw webhooks | S3 event inbox (`raw_payload_ref` in the payment event schema) |
| Notification providers | SNS (SMS) for PoC; WhatsApp deferred |
| Payment providers | `SIMULATED` provider adapter first, then MTN MoMo sandbox (§17) |
| Soundbox hardware | Virtual device (IoT Core MQTT subscriber) for PoC; ESP32 later |
| Monitoring | CloudWatch logs/metrics/dashboards |

Infrastructure will be added as a `GhanaPaymentsStack` under `packages/infrastructure/lib/` (following the `JiraDashboardStack` precedent) once the plan in `docs/planning/` is agreed.

## Status

**Planning.** No deployable code yet — `src/shared/types.ts` seeds the domain model from the spec. Start with the planning workflow in [`docs/planning/README.md`](docs/planning/README.md).
