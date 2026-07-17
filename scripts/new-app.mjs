#!/usr/bin/env node
/**
 * Scaffold a new self-contained AWS app from templates/aws-app.
 *
 *   node scripts/new-app.mjs --name orders-api [--dir apps] [--title "Orders API"]
 *
 * Produces apps/<name>/ — a minimal API Gateway + Lambda + DynamoDB app with its
 * own CDK app, deploy/destroy scripts, tests, and (for once extracted) its own
 * GitHub workflows. It also wires the per-app monorepo pipelines at the repo root
 * (<name>-deploy / -destroy / -pr-preview, path-scoped to apps/<name>/**), matching
 * the existing apps. Because it is self-contained it can later be lifted out with
 * scripts/extract-app.mjs.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'templates', 'aws-app');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const name = args.name;
if (!name || typeof name !== 'string') {
  console.error('Usage: node scripts/new-app.mjs --name <kebab-case> [--dir apps] [--title "Title"]');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
  console.error(`Invalid --name "${name}". Use kebab-case, e.g. orders-api`);
  process.exit(1);
}
const pascal = name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const title = typeof args.title === 'string' ? args.title : name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const dir = typeof args.dir === 'string' ? args.dir : 'apps';
const dest = isAbsolute(dir) ? join(dir, name) : join(ROOT, dir, name);

if (existsSync(dest)) {
  console.error(`Target already exists: ${dir}/${name} — pick another name or remove it first.`);
  process.exit(1);
}

const tokens = { __APP_NAME__: name, __APP_PASCAL__: pascal, __APP_TITLE__: title };
const sub = (s) => s.replace(/__APP_NAME__|__APP_PASCAL__|__APP_TITLE__/g, (m) => tokens[m]);

function walk(srcDir) {
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const rel = sub(relative(TEMPLATE, srcPath));
    const outPath = join(dest, rel);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(outPath, { recursive: true });
      walk(srcPath);
    } else {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, sub(readFileSync(srcPath, 'utf8')));
      if (outPath.endsWith('.sh')) chmodSync(outPath, 0o755);
    }
  }
}

mkdirSync(dest, { recursive: true });
walk(TEMPLATE);

// Wire the per-app monorepo pipelines at the repo root, path-scoped to this app —
// same pattern as the existing apps. Skipped when scaffolding to an external dir
// (an absolute --dir), where there is no monorepo to wire into.
let wroteWorkflows = false;
if (!isAbsolute(dir)) {
  const wfDir = join(ROOT, '.github', 'workflows');
  mkdirSync(wfDir, { recursive: true });
  const deploy = `name: ${title} — Deploy
on:
  workflow_dispatch:
    inputs:
      stage:
        description: 'Environment to deploy to'
        required: true
        type: choice
        options: [dev, test, prod]
        default: dev
permissions:
  contents: read
env:
  AWS_REGION: 'us-east-1'
jobs:
  deploy:
    name: Deploy to \${{ inputs.stage }}
    runs-on: ubuntu-latest
    environment: \${{ inputs.stage }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ env.AWS_REGION }}
      - run: chmod +x apps/${name}/scripts/*.sh
      - name: Deploy
        env: { STAGE: '\${{ inputs.stage }}' }
        run: cd apps/${name} && ./scripts/deploy.sh "\${{ inputs.stage }}"
`;
  const destroy = `name: ${title} — Destroy
on:
  workflow_dispatch:
    inputs:
      stage:
        description: 'Environment to destroy'
        required: true
        type: choice
        options: [dev, test, prod]
      confirm:
        description: 'Type DESTROY to confirm'
        required: true
        type: string
permissions:
  contents: read
env:
  AWS_REGION: 'us-east-1'
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - run: '[ "\${{ inputs.confirm }}" = "DESTROY" ] || { echo "::error::Type DESTROY"; exit 1; }'
  destroy:
    needs: guard
    runs-on: ubuntu-latest
    environment: \${{ inputs.stage }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ env.AWS_REGION }}
      - run: chmod +x apps/${name}/scripts/*.sh
      - env: { STAGE: '\${{ inputs.stage }}' }
        run: cd apps/${name} && echo "\${{ inputs.stage }}" | ./scripts/destroy.sh "\${{ inputs.stage }}"
`;
  const preview = `name: ${title} — PR Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]
    paths:
      - 'apps/${name}/**'
      - '.github/workflows/${name}-*.yml'
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: ${name}-preview-\${{ github.event.pull_request.number }}
  cancel-in-progress: false
env:
  AWS_REGION: 'us-east-1'
jobs:
  deploy-preview:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ env.AWS_REGION }}
      - run: chmod +x apps/${name}/scripts/*.sh
      - name: Deploy preview
        env: { STAGE: 'pr-\${{ github.event.pull_request.number }}' }
        run: cd apps/${name} && ./scripts/deploy.sh "pr-\${{ github.event.pull_request.number }}"
  destroy-preview:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ env.AWS_REGION }}
      - run: chmod +x apps/${name}/scripts/*.sh
      - env: { STAGE: 'pr-\${{ github.event.pull_request.number }}' }
        run: cd apps/${name} && echo "pr-\${{ github.event.pull_request.number }}" | ./scripts/destroy.sh "pr-\${{ github.event.pull_request.number }}"
`;
  for (const [file, content] of [
    [`${name}-deploy.yml`, deploy],
    [`${name}-destroy.yml`, destroy],
    [`${name}-pr-preview.yml`, preview],
  ]) {
    const p = join(wfDir, file);
    if (existsSync(p)) { console.warn(`  ! skipped .github/workflows/${file} (already exists)`); continue; }
    writeFileSync(p, content);
  }
  wroteWorkflows = true;
}

console.log(`\n✓ Created ${dir}/${name}  (${pascal}Stack, "${title}")\n`);
if (wroteWorkflows) console.log(`✓ Wired root pipelines: .github/workflows/${name}-{deploy,destroy,pr-preview}.yml\n`);
console.log('Next:');
console.log(`  cd ${dir}/${name} && npm install`);
console.log('  npm test && npm run synth        # prove it builds');
console.log('  npm run deploy dev               # deploy to your AWS account');
console.log(`  # later, lift it out: node scripts/extract-app.mjs ${name} ../${name}\n`);
