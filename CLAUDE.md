# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A monorepo of **self-contained AWS serverless applications**. Each app under `apps/` owns
everything it needs — its own CDK app, infrastructure stacks, Lambda code, web frontend,
deploy/destroy scripts, dependencies, and CI/CD pipelines. Apps do **not** share code or
infrastructure with each other.

The guiding principle: **any app can be copied out to its own repository and still work**,
without dragging along anything specific to another app.

## Repository Structure

```
apps/
├── ghana-payments/     # Ghana digital payments PoC (API Gateway + Lambda + DynamoDB + IoT soundbox)
├── jira-dashboard/     # Jira analytics (CSV upload → Step Functions → dashboard)
└── balance-booking/    # Pilates studio booking (Cognito + AppSync + DynamoDB + React)

scripts/                # Repo-level helpers only (init-claude, setup-aws-access)
.github/workflows/      # Per-app pipelines: <app>-deploy.yml / -destroy.yml / -pr-preview.yml
                        # plus ci.yml (lint/build/test) and Claude workflows
```

There is **no shared `packages/` layer** and **no monolithic deploy pipeline** — those were
removed. Each app is the unit of deployment.

## Anatomy of an App

Every app under `apps/<name>/` is structured the same way and is independently deployable:

```
apps/<name>/
├── bin/app.ts          # The app's own CDK entry — instantiates ONLY this app's stacks
├── lib/                # CDK stack definitions for this app
├── src/                # Lambda function source (TypeScript, bundled by NodejsFunction/esbuild)
├── web-app/            # Frontend (React/Vite or static), if the app has one
├── scripts/            # deploy.sh / destroy.sh and app-specific helpers
├── cdk.json            # `npx tsx bin/app.ts` — tsx runs the ESM CDK app directly
├── tsconfig.json       # Self-contained (does NOT extend a root tsconfig)
└── package.json        # Own deps, including aws-cdk-lib, aws-cdk, tsx, esbuild
```

Key conventions that keep apps self-contained and extractable:

- **Own CDK app.** `bin/app.ts` instantiates only that app's stacks, so `cdk deploy --all`
  from inside the app can never touch another app.
- **Stage from `process.env.STAGE`** (default `dev`), stacks named `${stage}-<app>-*`.
- **`tsx`, not `ts-node`.** `cdk.json` runs `npx tsx bin/app.ts` for reliable ESM.
- **Own dependencies.** Every AWS SDK client a Lambda imports must be in that app's
  `package.json` — nothing relies on monorepo hoisting.
- **Relative asset paths stay inside the app** (e.g. `../src/...`, `../web-app/dist`).

## Common Commands

Root scripts operate across all apps via npm workspaces (`apps/*`):

```bash
npm install            # Install all app dependencies (workspaces)
npm run build          # Typecheck/build every app (--workspaces --if-present)
npm run test           # Run every app's tests
npm run lint           # ESLint across the repo
npm run format         # Prettier
```

**Per-app deploy/destroy** — always run from inside the app (or via its workflow):

```bash
cd apps/<name>
STAGE=dev ./scripts/deploy.sh dev      # deploy this app to an environment
STAGE=dev ./scripts/destroy.sh dev     # destroy this app's stacks for an environment
npm run build                          # typecheck this app
npx cdk diff                           # preview changes (from the app dir)
```

Each app's `scripts/deploy.sh` handles its own specifics (e.g. building the web frontend
with the API URL after the backend deploys, seeding data, IoT policy setup). The
`destroy.sh` for `jira-dashboard` and `ghana-payments` prompts for the stage name on
`prod`/`test`; pipe it in for automation (`echo prod | ./scripts/destroy.sh prod`).

## CI/CD (GitHub Actions)

Pipelines are **per app**, path-scoped so a change to one app never deploys another:

- `.github/workflows/<app>-deploy.yml` — manual `workflow_dispatch` deploy to dev/test/prod.
- `.github/workflows/<app>-destroy.yml` — manual destroy (type `DESTROY` to confirm).
- `.github/workflows/<app>-pr-preview.yml` — auto-creates a `pr-<n>` environment on PRs that
  touch `apps/<name>/**`, destroys it on close.
- `.github/workflows/ci.yml` — lint/build/test on every PR.

Each workflow does `cd apps/<name> && ./scripts/deploy.sh` and is filtered with a
`paths:` allow-list of `apps/<name>/**`.

### GitHub Secrets
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

## Adding a New App

1. Create `apps/<name>/` following the anatomy above (copy an existing app as a template).
2. Give it its own `bin/app.ts`, `cdk.json` (`npx tsx bin/app.ts`), self-contained
   `tsconfig.json`, and a `package.json` with `aws-cdk-lib`, `aws-cdk`, `tsx`, `esbuild`
   plus whatever AWS SDK clients its Lambdas import.
3. Name stacks `${stage}-<name>-*` and read stage from `process.env.STAGE`.
4. Add `scripts/deploy.sh` and `scripts/destroy.sh`.
5. Add three workflows `<name>-deploy.yml` / `-destroy.yml` / `-pr-preview.yml`,
   path-scoped to `apps/<name>/**`.
6. `npm install` at the root picks it up as a workspace automatically.

## Extracting an App to Its Own Repo

Because each app is self-contained, extraction is a copy:

1. Copy `apps/<name>/` to a new directory (exclude `node_modules`, `dist`, `cdk.out`).
2. Remove the `workspaces` field from the copied `package.json` (it's now standalone).
3. `npm install` — the app already declares all its own dependencies.
4. `git init` and deploy with `./scripts/deploy.sh`.

Nothing app-specific to another app comes along, because nothing is shared.

## Conventions

- **Stack names:** `${stage}-<app>-<service>` (e.g. `dev-ghana-payments-api`).
- **Stages:** `dev` (pay-per-request, DESTROY policy), `test`/`prod` (provisioned,
  deletion protection, RETAIN). PR previews are `pr-<n>`, dev-like.
- **Runtime:** Node.js 20.x, ES Modules, TypeScript strict mode.
- **Tags:** `App`, `Environment`, `ManagedBy: CDK`.

## AWS Authentication

IAM access keys for local dev and GitHub Actions.
- Account: set via `aws configure` / `AWS_ACCOUNT_ID` (do not commit real account IDs).
- IAM user: `cdk-deployer`, region `us-east-1`.
- Verify: `aws sts get-caller-identity`.
- First-time per account/region: `cd apps/<name> && npx cdk bootstrap`.

## Per-App Documentation

Each app carries its own docs under `apps/<name>/` (READMEs, runbooks, device setup, etc.).
Start there for app-specific architecture and operations. `apps/ghana-payments/docs/`
in particular has `CODE_TOUR.md`, `DEVICE_SETUP.md`, and `RUNBOOK.md`.
