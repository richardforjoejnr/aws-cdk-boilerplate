# AWS app templates

Scaffold and extract self-contained AWS serverless apps. Every generated app owns
its **whole stack** (its own CDK app, deploy/destroy scripts, workflows), so it
runs inside this monorepo *and* lifts out into a standalone repo with one command —
both deploying to your AWS account.

## Create a new app

```bash
npm run new-app -- --name orders-api --title "Orders API"
# → apps/orders-api/ : API Gateway + Lambda + DynamoDB, tests, CI, deploy/destroy
# + .github/workflows/orders-api-{deploy,destroy,pr-preview}.yml at the repo root
#   (path-scoped to apps/orders-api/**), matching the other apps
```

Then:
```bash
cd apps/orders-api
npm install
npm test && npm run synth     # prove it builds
npm run deploy dev            # deploy to your AWS account — prints the API URL
```

Options: `--name <kebab-case>` (required), `--title "Human Title"`, `--dir <path>`
(default `apps`).

## Extract an app to its own repo

```bash
npm run extract-app -- orders-api ../orders-api --git
# → ../orders-api : a standalone repo (node_modules & workspace hints stripped,
#   .github workflows at root, git initialised)
```

Then push it to a new GitHub repo, set secrets `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`, and **Actions → Deploy** runs the same pipeline against
your AWS account. `npm run deploy dev` works locally too.

## What a generated app contains (`templates/aws-app/`)

```
bin/app.ts                self-contained CDK app (stage-prefixed: dev-/test-/prod-)
lib/<app>-stack.ts        DynamoDB table + Lambda (Node 20 ESM) + API Gateway
src/handler/index.ts      REST handler (health, POST/GET /items) + unit tests
scripts/deploy.sh         build+test+deploy, prints API URL (+ CI summary)
scripts/destroy.sh        cdk destroy + verify nothing remains
.github/workflows/        ci (PR), deploy (manual), destroy (manual, typed DESTROY)
cdk.json, tsconfig, jest, eslint, README
```

Design choices baked in (learned the hard way in this repo):
- **Self-contained** — no shared `bin/app.ts`, so `cdk deploy` never sweeps in
  another app; extraction is a clean copy, not an untangle.
- **Manual deploys only** — no push-to-main auto-deploy, so merging never
  surprises production.
- **Non-prod destroys to zero** (DESTROY removal policy); prod retains data.
- **Verified**: the generator + extractor are proven generate → deploy → live API →
  extract → standalone-deploy end to end.

## Extending an app

Add routes in `src/handler/index.ts`, or split into more Lambdas + resources in the
stack. Add tables/queues/buses as constructs and grant the Lambda least-privilege
access. For a web frontend (S3 + CloudFront) or an event bus, the `ghana-payments`
app (`apps/ghana-payments`) is a fuller worked example of the same pattern.
