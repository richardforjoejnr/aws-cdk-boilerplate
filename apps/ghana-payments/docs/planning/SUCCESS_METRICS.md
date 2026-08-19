# PoC Success Metrics — what to measure in the Accra trial

What data the pilot must produce to evaluate the PoC, derived from the concept
document (`docs/Expanded_Ghana_Digital_Payments_Concept.docx` / `docs/concept.md`).
Each metric maps to a concept requirement and to where it is now captured.

## The two questions the trial must answer

1. **Does the vendor hear the money fast enough to trust it?** Concept §15 sets
   the NFR: *"webhook to soundbox announcement target under 5 seconds under
   normal network conditions."* The soundbox exists to defeat fake-screenshot
   fraud (§12.1) — that only works if the audio is prompt and reliable enough
   that vendors wait for it instead of trusting the customer's phone.
2. **Which connectivity model do we ship?** Concept §21 leaves the soundbox
   connectivity model (4G SIM vs Wi-Fi vs hybrid) as an open decision "based on
   pilot market conditions". The Accra trial on Wi-Fi and mobile data is that
   evidence.

## Primary metrics (go/no-go signal)

| Metric | Target | Concept ref | Where measured |
|---|---|---|---|
| **Webhook → audio latency** (confirmed_at → played_at), p50/p95 | p95 < 5 s | §15 NFR | `WebhookToAudioMs` metric; `GET /v1/observability/latency`; portal Latency panel |
| **% of announcements under 5 s** | ≥ 95 % | §15 NFR | `under_target_rate` in the latency API, overall and per network |
| **Latency by network type** (WIFI / 4G / 3G / 2G) | comparison, no fixed target | §21 open decision, §17.9 hardware options | `network_type` dimension on latency metrics; `by_network` in the latency API |
| **Audio delivery rate** (played / announced) | ≥ 99 % | §4 device persona "reliable connectivity"; §17.8 retry model | `delivery_rate` in the latency API; `AnnouncementPlayedCount` metric |
| **Payment success rate** | ≥ 95 % of initiated | §7 flows | overview API (`success_rate`), dashboard |

## Latency segments (where the time goes)

The full chain is timestamped on the payment record, so slowness is attributable:

```
created_at ──────► confirmed_at ─────► announced_at ─────► played_at
  (payment          (provider/           (EventBridge →      (device audio —
   initiated)        webhook)             IoT publish)        the vendor hears it)
     └─ initiated_to_confirmed ─┴─ confirmed_to_announced ─┴─ announced_to_played
                          webhook_to_audio  =  confirmed_at → played_at   (the <5s SLO)
                          end_to_end        =  created_at  → played_at
```

- `initiated_to_confirmed` is provider-side (MTN MoMo sandbox/mock today) — not
  ours to fix, but must be known to interpret end-to-end numbers.
- `confirmed_to_announced` is our platform (EventBridge → announcer → IoT publish).
- `announced_to_played` is the network + device — the Wi-Fi vs mobile-data
  comparator, measured per `network_type` reported by the device in its ack.

## Secondary metrics (health & adoption context)

| Metric | Why | Where |
|---|---|---|
| Device uptime / online rate, reconnect gaps | §15 availability 99.5 %; §17.9 "less reliable for mobile hawkers" is the Wi-Fi risk to verify | fleet API (`last_seen_at`), telemetry table time-series |
| Battery drain + signal (RSSI) by network | 4G radio costs battery — feeds the hardware decision | heartbeats → telemetry table |
| Transactions & volume per merchant/soundbox | adoption/value evidence (§2 — verified transaction history) | overview API, metrics rollups |
| Failure/expiry reasons, DLQ depth | operational readiness (Appendix C/D) | failures API, alarms |
| Duplicate callbacks / late callbacks / duplicate announcements suppressed | fraud & idempotency controls actually firing (§12.1, Appendix B) | `IDEM#` rows, `ANOMALY_LATE_CALLBACK` events |

## How the signal is captured (implementation)

1. Device plays the announcement, then acks on its heartbeat topic:
   `{status:'played', payment_id, network_type, battery, signal}`.
2. `device-status-updater` resolves the topic identity (Thing name → device_id),
   stamps `played_at`/`played_network_type` on the payment META (exactly-once),
   appends a `DEVICE_PLAYED` event, and emits EMF metrics `WebhookToAudioMs`,
   `DeliveryLatencyMs`, `EndToEndLatencyMs`, `AnnouncementPlayedCount` — all
   dimensioned by `network_type` (low-cardinality, per the observability plan).
3. `GET /v1/observability/latency?days=N` computes p50/p95 per segment, the
   under-5s rate, delivery rate, per-network breakdown, daily trend, and a
   recent-payments list (for one-click tracing) from SUCCESS payment records.
4. The portal Observability panel renders the SLO KPIs, segment breakdown,
   Wi-Fi vs mobile comparison, and recent payments with trace buttons. The
   CloudWatch dashboard adds "Webhook → audio played" and per-network delivery
   latency widgets.

## Trial protocol note (Accra)

To make the Wi-Fi vs mobile-data comparison fair, run the same device model in
both modes at the same stall/times where possible (`--network=` flag on the
device clients; real hardware reports its radio). Record the operator (MTN,
Telecel, AT) in the heartbeat `operator` field so per-operator splits are
possible later from the telemetry table.

## Known measurement caveats

- `played_at` is stamped server-side when the ack arrives, so it includes the
  device→cloud ack hop (~one RTT). Latencies are therefore slightly pessimistic
  — acceptable, and unbiased between networks only to the extent uplink ≈
  symmetric; note it when quoting absolute numbers.
- The browser soundbox simulator approximates `network_type` from
  `navigator.connection` (speed-based, not radio) — trust the flag on the Node
  device clients / real hardware for the comparison.
- Provider latency in dev uses the mock provider; real MTN sandbox timings will
  shift `initiated_to_confirmed` but not the segments we own.
