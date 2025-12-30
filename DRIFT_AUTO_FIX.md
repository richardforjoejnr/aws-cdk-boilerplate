# Automatic CloudFormation Drift Detection and Remediation

## Problem

When DynamoDB tables (or other resources) are deleted outside of CloudFormation, the stacks enter a "drift" state where:
- CloudFormation thinks the resource exists (stack shows `CREATE_COMPLETE`)
- The actual AWS resource doesn't exist
- Attempting to update the stack fails with: `Unable to retrieve Arn attribute for AWS::DynamoDB::Table, with error message Table: {table-name} does not exist`
- The stack enters `UPDATE_ROLLBACK_COMPLETE` state, blocking all future deployments

## Solution

The deployment pipeline now **automatically detects and fixes drift** before attempting any updates:

### 1. Drift Detection (`fix-cloudformation-drift.sh`)

The script checks if actual AWS resources exist for each CloudFormation stack:

```bash
# Check if DynamoDB table exists
aws dynamodb describe-table --table-name pr-4-main-table

# Compare with what CloudFormation thinks exists
aws cloudformation describe-stack-resources --stack-name pr-4-aws-boilerplate-database
```

### 2. Automatic Remediation

When drift is detected, the script **automatically deletes** the drifted stacks in the correct dependency order:

**Deletion Order** (dependencies first):
1. `{stage}-aws-boilerplate-appsync` (depends on Database & Lambda)
2. `{stage}-aws-boilerplate-step-functions`
3. `{stage}-aws-boilerplate-lambda`
4. `{stage}-aws-boilerplate-database`

### 3. Fresh Deployment

After removing drifted stacks, the deployment continues and recreates everything fresh with:
- New DynamoDB tables
- New Lambda functions
- New AppSync API
- Correctly configured web app

## How It Works

### Before (Manual Fix Required)
```bash
# Deployment fails with drift
npm run deploy:pr-4:webapp
❌ Error: Table pr-4-main-table does not exist
❌ Stack enters UPDATE_ROLLBACK_COMPLETE

# Manual intervention required
cdk destroy --all --force
npm run deploy:pr-4:webapp
```

### After (Automatic Fix)
```bash
# Deployment detects and fixes drift automatically
npm run deploy:pr-4:webapp

🔍 Detecting CloudFormation drift for pr-4 environment
  ✗ DRIFT DETECTED: Resource pr-4-main-table does not exist

🔧 Auto-fixing drift by deleting drifted stacks...
Deleting drifted stack: pr-4-aws-boilerplate-appsync
  ✓ Stack deletion initiated
  ⏳ Waiting for stack deletion to complete...
  ✓ Stack deleted successfully

Deleting drifted stack: pr-4-aws-boilerplate-database
  ✓ Stack deleted successfully

✅ Drift fixed! Drifted stacks have been deleted.
💡 The deployment will now recreate these stacks fresh.

📦 Building all packages...
🚀 Deploying infrastructure...
✅ Deployment completed successfully!
```

## What Changed

### `scripts/fix-cloudformation-drift.sh`
- **Before**: Only detected drift and exited with error
- **After**: Detects drift AND automatically deletes drifted stacks
- Handles failed deletions with retry logic
- Deletes stacks in correct dependency order

### `scripts/deploy-with-cleanup.sh`
- **Before**: Silently ignored drift with warning
- **After**: Calls drift detection/remediation script and shows full output
- Drift is fixed before attempting any stack updates

## Benefits

1. **Zero Manual Intervention**: Deployments self-heal from drift
2. **Prevents Deployment Failures**: Can't get stuck in `UPDATE_ROLLBACK_COMPLETE`
3. **Safe Deletion Order**: Respects stack dependencies
4. **Retry Logic**: Handles edge cases like `DELETE_FAILED` states
5. **Clear Feedback**: Shows exactly what's happening during remediation

## When Drift Occurs

Drift can happen when:
- Someone manually deletes a DynamoDB table in AWS Console
- A script deletes resources outside CloudFormation
- AWS service issues cause resource deletion
- Accidental `aws dynamodb delete-table` commands

## Example Scenarios

### Scenario 1: Database Stack Drift
```
Problem: DynamoDB table deleted manually
Detection: ✓ Automatic
Remediation: Deletes database stack
Result: Fresh deployment creates new table
```

### Scenario 2: Multiple Stacks Drifted
```
Problem: Database AND AppSync stacks drifted
Detection: ✓ Automatic
Remediation: Deletes AppSync first (dependency), then Database
Result: Both stacks recreated fresh
```

### Scenario 3: Failed Stack Deletion
```
Problem: Stack deletion fails during remediation
Detection: ✓ Automatic
Remediation: Retries deletion automatically
Result: Eventually succeeds or exits with clear error
```

## Testing

To test drift detection:
```bash
# Simulate drift by deleting a table
aws dynamodb delete-table --table-name dev-main-table

# Run deployment - drift will be auto-fixed
npm run deploy:dev:webapp

# Verify: Deployment succeeds and creates new table
aws dynamodb describe-table --table-name dev-main-table
```

## Monitoring

The drift detection runs on every deployment in Step 1.5:
```
📋 Step 1: Running pre-deployment cleanup...
🔍 Step 1.5: Detecting and fixing CloudFormation drift...
📦 Step 2: Building all packages...
🚀 Step 3: Deploying infrastructure...
```

Check deployment logs to see if drift was detected and fixed.
