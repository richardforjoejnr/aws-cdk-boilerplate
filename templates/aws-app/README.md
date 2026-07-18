# __APP_TITLE__

AWS serverless app — **API Gateway → Lambda (Node 20, ESM) → DynamoDB**, deployed with CDK. Self-contained: it has its own CDK app, so deploying it never touches any other stack.

## Develop

```bash
npm install
npm run build      # typecheck
npm test           # unit tests
npm run synth      # render CloudFormation
npm run diff       # preview changes vs deployed
```

## Deploy / destroy (uses your AWS credentials)

```bash
npm run deploy dev            # or test / prod  — prints the API URL
npm run destroy dev
```

Or in CI: **Actions → Deploy** (manual, pick the stage) and **Actions → Destroy** (type `DESTROY`). Set repo secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

## Try it

```bash
API=$(aws cloudformation describe-stacks --stack-name dev-__APP_NAME__ \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
curl "$API"                                   # health
curl -X POST "${API}items" -d '{"name":"hello"}'   # create
curl "${API}items"                            # list
```

## Layout

```
bin/app.ts                  CDK app entry (stage-prefixed, self-contained)
lib/__APP_NAME__-stack.ts   the stack: table + Lambda + API
src/handler/index.ts        the API handler (+ .test.ts)
scripts/deploy.sh|destroy.sh
.github/workflows/          ci, deploy (manual), destroy (manual)
```

## Extend

- **New route:** add a branch in `src/handler/index.ts` (or split into more Lambdas + `addResource` in the stack).
- **More tables / a queue / an event bus:** add constructs to the stack; grant the Lambda least-privilege access.
- **A web frontend:** add an S3 + CloudFront stack (see the parent template repo's fuller examples).

Generated from the `aws-app` template.
