# CloudFormation Drift Prevention Guide

## What is CloudFormation Drift?

**Drift** occurs when the actual state of your AWS resources doesn't match what CloudFormation thinks it should be. This typically happens when:

1. Resources are manually deleted (via AWS Console or CLI)
2. Resources are modified outside of CloudFormation
3. CloudFormation stacks are deleted but resources remain

## The Problem We Fixed

### Before (What Was Happening)
```
1. You run: npm run destroy:dev
2. Some resources get deleted (tables, etc.)
3. CloudFormation stacks remain thinking resources exist
4. Next deployment: "no changes" but resources are missing
5. Web app fails: "DynamoDB:ResourceNotFoundException"
```

### After (What Happens Now)
```
1. You run: npm run deploy:dev
2. Automatic drift detection runs
3. Drifted stacks are identified
4. Missing resources are recreated
5. Everything works! ✅
```

## New Commands

### Check for Drift
```bash
# Check if CloudFormation is out of sync with reality
npm run drift:check:dev
npm run drift:check:test
npm run drift:check:prod
```

### Fix Drift Automatically
```bash
# Detect drift, delete drifted stacks, and redeploy fresh
npm run drift:fix:dev
npm run drift:fix:test
npm run drift:fix:prod
```

## How It Works

### 1. Automatic Drift Detection (Built into deploy:dev)

The smart deployment script now:
```bash
npm run deploy:dev
```

Automatically runs:
1. ✅ Cleanup orphaned resources
2. ✅ **Detect CloudFormation drift** (NEW!)
3. ✅ Fix any drift found
4. ✅ Deploy infrastructure
5. ✅ Validate deployment

### 2. Manual Drift Check

```bash
npm run drift:check:dev
```

**Output example:**
```
🔍 Detecting CloudFormation drift for dev environment

Checking dev-aws-boilerplate-database...
  ✗ DRIFT DETECTED: Resource dev-main-table does not exist but stack thinks it does

❌ Drift detected! CloudFormation stacks are out of sync.
📋 Recommended fix:
   Run: npm run drift:fix:dev
```

### 3. Automatic Drift Fix

```bash
npm run drift:fix:dev
```

This script:
1. Detects which stacks have drift
2. Safely deletes drifted stacks
3. Redeploys everything fresh
4. Validates the deployment

## Common Scenarios

### Scenario 1: Accidentally Deleted a Resource

**Problem:**
```bash
# You accidentally deleted the DynamoDB table
aws dynamodb delete-table --table-name dev-main-table

# Next deployment says "no changes" but table is missing!
npm run deploy:dev  # ❌ Fails
```

**Solution (Automatic):**
```bash
npm run deploy:dev  # ✅ Now automatically detects and fixes drift!
```

**Solution (Manual):**
```bash
npm run drift:fix:dev  # Explicitly fix drift and redeploy
```

### Scenario 2: Destroy Didn't Clean Up Properly

**Problem:**
```bash
npm run destroy:dev  # Some resources remain
npm run deploy:dev   # ❌ "Resource already exists" errors
```

**Solution:**
```bash
npm run deploy:dev  # ✅ Automatic cleanup + drift detection handles this!
```

### Scenario 3: CloudFormation Stack Deleted But Resources Remain

**Problem:**
```bash
# Stack was manually deleted but table still exists
aws cloudformation delete-stack --stack-name dev-aws-boilerplate-database
# Table dev-main-table still exists!

npm run deploy:dev  # ❌ "Resource already exists"
```

**Solution:**
```bash
npm run cleanup:orphaned:dev  # Clean up leftover resources
npm run deploy:dev            # Fresh deployment
```

## Prevention Best Practices

### DO ✅

1. **Always use the npm scripts for deployment**
   ```bash
   npm run deploy:dev
   npm run deploy:prod
   ```

2. **Use cleanup scripts before manual operations**
   ```bash
   npm run cleanup:orphaned:dev
   ```

3. **Check for drift periodically**
   ```bash
   npm run drift:check:prod
   ```

4. **Use destroy commands to remove resources**
   ```bash
   npm run destroy:dev
   ```

### DON'T ❌

1. **Don't manually delete resources from AWS Console**
   - Use CloudFormation/CDK to manage lifecycle

2. **Don't manually delete CloudFormation stacks without deleting resources first**
   - Use `npm run destroy:dev` instead

3. **Don't modify resources outside of CloudFormation**
   - Changes will be overwritten on next deployment

## Troubleshooting

### "Resource already exists" Error

**Cause:** Orphaned resource from previous deployment

**Fix:**
```bash
npm run cleanup:orphaned:dev
npm run deploy:dev
```

### "ResourceNotFoundException" Error

**Cause:** CloudFormation drift - stack thinks resource exists but it doesn't

**Fix:**
```bash
npm run drift:fix:dev
```

### Stack Says "No Changes" But Resources Are Missing

**Cause:** CloudFormation drift

**Fix:**
```bash
npm run drift:check:dev  # Confirm drift
npm run drift:fix:dev    # Fix it
```

## How Drift Detection Works

The `fix-cloudformation-drift.sh` script:

1. **Lists CloudFormation stacks** for the environment
2. **Checks each resource** in the stack
3. **Compares with actual AWS resources**:
   - DynamoDB tables: `aws dynamodb describe-table`
   - Log groups: `aws logs describe-log-groups`
   - Lambda functions: `aws lambda get-function`
4. **Reports drift** if CloudFormation and reality don't match
5. **Optionally fixes** by deleting drifted stacks and redeploying

## Architecture

### Drift Prevention Flow

```
┌─────────────────────────────────────────┐
│     npm run deploy:dev                  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  1. Cleanup Orphaned Resources          │
│     - Delete resources NOT managed by   │
│       CloudFormation                    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  2. Detect CloudFormation Drift         │
│     - Compare CloudFormation state      │
│       with actual AWS resources         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  3. Fix Drift (if detected)             │
│     - Delete drifted stacks             │
│     - Resources will be recreated       │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  4. Deploy Infrastructure               │
│     - Create/update all stacks          │
│     - Recreate missing resources        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  5. Validate Deployment                 │
│     - Ensure all resources exist        │
│     - Test connectivity                 │
└─────────────────────────────────────────┘
```

## Files

- `scripts/fix-cloudformation-drift.sh` - Detects drift
- `scripts/fix-drift-and-redeploy.sh` - Fixes drift and redeploys
- `scripts/cleanup-orphaned-resources.sh` - Cleans orphaned resources (updated with drift warnings)
- `scripts/deploy-with-cleanup.sh` - Main deployment (now includes drift detection)

## Summary

**Before:** Manual cleanup, drift issues, confusing errors

**After:** Automatic drift detection and prevention, self-healing deployments! 🎉

You'll never have to worry about CloudFormation drift again - it's all handled automatically!
