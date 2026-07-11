# Ghana Payments PoC — Runbook

How to create, operate, verify, and destroy everything in this project. All commands run from the **repo root** unless noted. Region: `us-east-1`, default stage: `dev`.

> URLs in examples (API IDs, CloudFront domains) are **per-deployment** — always derive them with the commands shown rather than hardcoding. Current dev API at time of writing: `https://04sqsd99vk.execute-api.us-east-1.amazonaws.com/dev/`.

---

## 1. What exists

| Thing | Name | Created by |
| --- | --- | --- |
| Data + event layer | `dev-ghana-payments-foundation` (7 DynamoDB tables, EventBridge bus, S3 webhook inbox, SSM config) | CDK stack |
| Payment core | `dev-ghana-payments-api` (REST API, 11 Lambdas, SQS mock-callback queue + DLQs, sweeper schedule, bus rules) | CDK stack |
| Phase 0 spike (throwaway) | `dev-ghana-payments-spike` (Cognito identity pool, IoT policy, attach Lambda) + local browser page | CDK stack (gated) |
| Pipelines | `Ghana Payments — Manual Deploy` / `— Manual Destroy` | GitHub Actions |
| Project agents | `ghana-architect`, `ghana-code-reviewer`, `ghana-test-designer`, `ghana-devops`, `ghana-verifier` | `.claude/agents/` |

Design/decision docs live in `packages/ghana-payments/docs/planning/` (start with `README.md` there).

## 2. Prerequisites

- AWS CLI authenticated as `cdk-deployer` (`aws sts get-caller-identity` should show the project account)
- Node 20+, `npm install` run at repo root
- CDK already bootstrapped in the account (one-time, done)

## 3. Deploy / recreate everything

```bash
npm run ghana:deploy:dev        # builds the package, deploys foundation + api stacks, prints outputs
```

Or from GitHub: **Actions → "Ghana Payments — Manual Deploy" → Run workflow → stage: dev**.

Single stack / preview:
```bash
cd packages/infrastructure
STAGE=dev npx cdk diff dev-ghana-payments-api        # preview changes
STAGE=dev npx cdk deploy dev-ghana-payments-api --require-approval never
```

## 4. Find your URLs and keys

```bash
# THE public URL (portals + API on one CloudFront domain — use this for everything)
PORTAL=$(aws cloudformation describe-stacks --stack-name dev-ghana-payments-web \
  --query "Stacks[0].Outputs[?OutputKey=='PortalUrl'].OutputValue" --output text)
echo $PORTAL   # e.g. https://dyn4xu0k0c66y.cloudfront.net
# $PORTAL/            landing page
# $PORTAL/admin/      merchant portal (asks for the admin API key, stored in your browser)
# $PORTAL/pay/{qr_id} payment portal (opened by scanning a QR)
# $PORTAL/api/v1/...  the same API as below, same-origin (what the portals call)

# API Gateway direct URL (works too; the CloudFront /api path is preferred)
API=$(aws cloudformation describe-stacks --stack-name dev-ghana-payments-api \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
echo $API    # e.g. https://04sqsd99vk.execute-api.us-east-1.amazonaws.com/dev/

# Admin API key (needed for merchant management endpoints)
KEY_ID=$(aws cloudformation describe-stacks --stack-name dev-ghana-payments-api \
  --query "Stacks[0].Outputs[?OutputKey=='AdminApiKeyId'].OutputValue" --output text)
API_KEY=$(aws apigateway get-api-key --api-key "$KEY_ID" --include-value --query value --output text)

# All foundation outputs (event bus, webhook inbox bucket, payments table)
aws cloudformation describe-stacks --stack-name dev-ghana-payments-foundation \
  --query 'Stacks[0].Outputs' --output table
```

## 5. Drive the system (Phase 2 flows)

```bash
# Create a merchant (admin — needs the API key)
curl -s -X POST "${API}v1/merchants" -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{"display_name":"Ama Serwaa Fruits","phone":"0201112222","business_category":"food"}'
# → {"merchant_id":"mer_...","status":"ACTIVE"}

# List / suspend merchants (admin)
curl -s "${API}v1/merchants" -H "x-api-key: $API_KEY"
curl -s -X PATCH "${API}v1/merchants/mer_XXX/status" -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{"status":"SUSPENDED","reason":"demo"}'

# Top up a customer wallet (public, simulated money; amounts are integer PESEWAS)
curl -s -X POST "${API}v1/wallets/0244123456/topup" -H 'content-type: application/json' \
  -d '{"amount_pesewas":10000}'                     # GHS 100.00
curl -s "${API}v1/wallets/0244123456"               # balance

# Initiate a payment (public — this is what the /pay portal will call)
curl -s -X POST "${API}v1/payments" -H 'content-type: application/json' \
  -d '{"merchant_id":"mer_XXX","amount_pesewas":2000,"payer_phone":"0244123456"}'
# → {"payment_id":"pay_...","status":"INITIATED"}

# Poll status (mock confirms async after ~3s)
curl -s "${API}v1/payments/pay_XXX"
```

### Magic amounts (mock outcome control — ADR-7)

| `amount_pesewas` | Outcome |
| --- | --- |
| `1300` (GHS 13.00) | FAILED callback → wallet auto credit-back |
| `999` (GHS 9.99) | No callback → sweeper marks EXPIRED after 5 min → credit-back |
| `222` (GHS 2.22) | Callback delivered TWICE → exactly one confirmation (idempotency demo) |
| anything else | SUCCESS |
| more than wallet balance | 402 INSUFFICIENT_FUNDS, no payment created |

Values are SSM parameters — change without redeploying:
```bash
aws ssm get-parameters-by-path --path /dev/ghana-payments/ --recursive \
  --query 'Parameters[].{Name:Name,Value:Value}' --output table
aws ssm put-parameter --name /dev/ghana-payments/sweeper/expiry-minutes --value 2 --overwrite
```
(Lambdas cache config for 60 s.)

### Prove webhook idempotency by hand

```bash
# Raw callbacks are archived in the S3 inbox before processing — replay one:
BUCKET=$(aws cloudformation describe-stacks --stack-name dev-ghana-payments-foundation \
  --query "Stacks[0].Outputs[?OutputKey=='WebhookInboxBucket'].OutputValue" --output text)
aws s3 ls s3://$BUCKET/webhooks/mock/ --recursive | tail -3
aws s3 cp s3://$BUCKET/<key-from-above> /tmp/replay.json
curl -s -X POST "${API}v1/webhooks/mock" -H 'content-type: application/json' -d @/tmp/replay.json
# → {"received":true,"duplicate":true}   (no second announcement, no ledger change)
```

### QR flows (Phase 3)

```bash
# Generate a QR badge for a merchant (admin) — returns PNG (base64) + the scannable URL
curl -s -X POST "$PORTAL/api/v1/merchants/mer_XXX/qrs" -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{}' \
  | python3 -c 'import json,sys,base64;d=json.load(sys.stdin);open("qr.png","wb").write(base64.b64decode(d["png_base64"]));print(d["payload_url"])'
# qr.png is now printable; scanning it opens $PORTAL/pay/{qr_id} on any phone

curl -s "$PORTAL/api/v1/qrs/qr_XXX/resolve"                     # public: merchant name check
curl -s -X POST "$PORTAL/api/v1/qrs/qr_XXX/rotate" -H "x-api-key: $API_KEY" -d '{}'   # compromised badge
```

Or just use the merchant portal (`$PORTAL/admin/`): create merchant → QR button → download PNG.

### Full automated end-to-end check

The scripted version of all of the above (used to verify Phase 2) can be re-run any time — ask the `ghana-verifier` agent, or see the checks it performs in `.claude/agents/ghana-verifier.md`.

## 5b. Soundbox devices (Phase 4 — the real flow)

All in the browser: **admin portal → Soundbox devices → Register** (any serial, e.g. `SBX-0001`) → **Pair…** (pick merchant, get a 6-digit code, valid 10 min) → open **`$PORTAL/soundbox/`** (laptop with speakers) → enter serial + code → it connects and speaks. Then scan the merchant's QR with a phone and pay — the soundbox announces within ~5 s, exactly once. The **Test** button sends a spoken test announcement.

Same flow via curl:

```bash
DEV_ID=$(curl -s -X POST "$PORTAL/api/v1/devices" -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{"serial_number":"SBX-0001"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["device_id"])')
curl -s -X POST "$PORTAL/api/v1/devices/$DEV_ID/pairing-code" -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{"merchant_id":"mer_XXX"}'      # → {"pairing_code":"123456"}
# the device itself then calls POST /v1/devices/pair {serial_number, pairing_code, identity_id}
curl -s -X POST "$PORTAL/api/v1/devices/$DEV_ID/events" -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' -d '{"event_type":"TEST_ANNOUNCEMENT"}'
```

Pairing attaches a **per-device IoT policy** to the browser's Cognito identity — the device can only touch its own `devices/{device_id}/*` topics. Heartbeats flip PAIRED→ACTIVE and update last-seen in the admin table. "Forget device" on the soundbox page clears the browser's pairing.

**Cost footer:** the admin portal footer shows account month-to-date + yesterday's spend (`GET /v1/costs`, admin-keyed, SSM-cached 6h because each Cost Explorer call bills $0.01; CE data lags ~24h).

## 6. Soundbox spike page (the `http://localhost:8642` thing — superseded by 5b)

Throwaway Phase 0 artifact proving browser → IoT Core MQTT + speech. Full detail: `packages/ghana-payments/spike/README.md`.

```bash
# Requires the spike stack (gated deploy):
cd packages/infrastructure && DEPLOY_GHANA_SPIKE=true STAGE=dev npx cdk deploy dev-ghana-payments-spike --require-approval never && cd ../..
./packages/ghana-payments/spike/configure.sh dev              # writes spike/.env + browser/config.js
cd packages/ghana-payments/spike/browser && python3 -m http.server 8642
# open http://localhost:8642 → click "Pair & Connect" → then publish:
aws iot-data publish --topic spike/announce --cli-binary-format raw-in-base64-out \
  --payload '{"message":"Payment received, 20 Ghana cedis","payment_id":"pay_demo_1"}'
```

Headless equivalent (no browser): `node packages/ghana-payments/spike/node-client.mjs`

The Phase 4 soundbox portal will replace this and be hosted on CloudFront (no localhost).

## 7. Health checks & monitoring

```bash
# Stack health
aws cloudformation describe-stacks --stack-name dev-ghana-payments-api --query 'Stacks[0].StackStatus'

# Lambda logs (each function has its own /aws/lambda/dev-ghana-* group, 1-week retention)
aws logs tail /aws/lambda/dev-ghana-webhook-receiver --follow
aws logs tail /aws/lambda/dev-ghana-sweeper --since 10m

# DLQs must be empty (mock-callbacks, credit-back, audit)
for q in dev-ghana-mock-callbacks-dlq dev-ghana-credit-back-dlq dev-ghana-audit-dlq; do
  echo "$q: $(aws sqs get-queue-attributes \
    --queue-url $(aws sqs get-queue-url --queue-name $q --query QueueUrl --output text) \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' --output text)"
done

# Audit trail (every bus event, TTL 90d)
aws dynamodb query --table-name dev-ghana-audit \
  --key-condition-expression '#d = :d' --expression-attribute-names '{"#d":"date"}' \
  --expression-attribute-values "{\":d\":{\"S\":\"$(date -u +%Y-%m-%d)\"}}" --output json \
  | python3 -c 'import json,sys;[print(i["sk"]["S"][:24], i["detail_type"]["S"]) for i in json.load(sys.stdin)["Items"]]'

# Ledger for one payment (META + EVT history + IDEM guard items)
aws dynamodb query --table-name dev-ghana-payments \
  --key-condition-expression 'payment_id = :p' \
  --expression-attribute-values '{":p":{"S":"pay_XXX"}}'
```

Costs: see `planning/cost-review.md` (idle ≈ $1/mo). Cost Explorer filter: tag `Project = AWS-Boilerplate`, or `Environment = dev`.

## 8. Tests

```bash
npm run test --workspace=@aws-boilerplate/ghana-payments   # 13 unit tests (idempotency, state machine, wallet, mock rules)
npm run build --workspace=@aws-boilerplate/ghana-payments  # typecheck
cd packages/infrastructure && STAGE=dev npx cdk synth dev-ghana-payments-api --quiet   # synth check
```

## 9. Teardown

```bash
npm run ghana:destroy:dev                                  # destroys api + foundation (dev = full delete, no orphans)
# Spike stack (separate, gated):
cd packages/infrastructure && DEPLOY_GHANA_SPIKE=true STAGE=dev npx cdk destroy dev-ghana-payments-spike --force
```

Or GitHub: **Actions → "Ghana Payments — Manual Destroy" → stage + type `DESTROY`**.

Dev resources use DESTROY removal policies (S3 auto-empties). `test`/`prod` would RETAIN tables/buckets — the destroy script warns and requires typed confirmation.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| Payment stuck INITIATED > 1 min | `aws logs tail /aws/lambda/dev-ghana-mock-delivery --since 10m` (callback delivery), then webhook-receiver logs; DLQ depth |
| Payment stuck PENDING forever with non-timeout amount | webhook-receiver logs; confirm `WEBHOOK_URL` env on mock-delivery matches the API |
| 403 on admin endpoints | missing/wrong `x-api-key` — re-fetch per §4 |
| Sweeper never expires | it only touches payments older than `sweeper/expiry-minutes` (default 5); check `/aws/lambda/dev-ghana-sweeper` logs |
| Duplicate announcement (Phase 4+) | ledger `announced_at` guard + device-side `payment_id` dedupe — see ADR-4b / F-3 |
| "Failed to fetch" from a browser page | duplicated CORS headers — Lambda behind a CORS-configured Function URL/API must not set `Access-Control-*` itself (spike-results.md) |
| Stack stuck UPDATE_ROLLBACK_COMPLETE | `npm run cleanup:failed:dev` (repo-wide helper) |
