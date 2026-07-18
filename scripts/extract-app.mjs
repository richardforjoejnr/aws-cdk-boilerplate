#!/usr/bin/env node
/**
 * Lift a self-contained app package out into its own standalone repo.
 *
 *   node scripts/extract-app.mjs <app-name|path> <target-dir> [--git]
 *   node scripts/extract-app.mjs orders-api ../orders-api        # from apps/orders-api
 *   node scripts/extract-app.mjs apps/orders-api ../orders-api   # explicit path
 *
 * The app already owns its whole stack (bin/app.ts, cdk.json, package.json,
 * scripts/, .github/workflows/), so extraction is a clean copy — the result is a
 * ready-to-run repo that deploys to the same AWS account via the same secrets.
 */
import { cpSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [srcArg, targetArg, ...rest] = process.argv.slice(2);
const doGit = rest.includes('--git');

if (!srcArg || !targetArg) {
  console.error('Usage: node scripts/extract-app.mjs <app-name|path> <target-dir> [--git]');
  process.exit(1);
}

const src = isAbsolute(srcArg) ? srcArg : existsSync(join(ROOT, srcArg)) ? join(ROOT, srcArg) : join(ROOT, 'apps', srcArg);
if (!existsSync(join(src, 'package.json')) || !existsSync(join(src, 'bin', 'app.ts'))) {
  console.error(`Not a self-contained app (need package.json + bin/app.ts): ${src}`);
  console.error('Only apps generated from templates/aws-app are extractable this way.');
  process.exit(1);
}
const target = isAbsolute(targetArg) ? targetArg : join(process.cwd(), targetArg);
if (existsSync(target)) {
  console.error(`Target already exists: ${target}`);
  process.exit(1);
}

const SKIP = new Set(['node_modules', 'dist', 'cdk.out', '.git']);
cpSync(src, target, {
  recursive: true,
  filter: (s) => !s.split(/[\\/]/).some((seg) => SKIP.has(seg)),
});

// Standalone repos install their own deps — drop any monorepo workspace hints.
const pkgPath = join(target, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
delete pkg.workspaces;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

if (doGit) {
  execSync('git init -q && git add -A && git commit -q -m "chore: extracted from monorepo template"', { cwd: target });
}

console.log(`\n✓ Extracted ${srcArg} → ${target}${doGit ? ' (git initialised)' : ''}\n`);
console.log('Next:');
console.log(`  cd ${targetArg}`);
if (!doGit) console.log('  git init && git add -A && git commit -m "initial"');
console.log('  npm install && npm test && npm run synth');
console.log('  npm run deploy dev');
console.log('  # push to a new GitHub repo, set secrets AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,');
console.log('  # then Actions → Deploy runs the same pipeline against your AWS account.\n');
