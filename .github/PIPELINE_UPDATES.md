# GitHub Actions Pipeline Updates

## Overview

Updated GitHub Actions workflows to use the new smart deployment scripts with automatic cleanup and validation.

## What Changed

### 1. Deploy Workflow (`.github/workflows/deploy.yml`)

**Before:**
- Manual CDK deployment
- No automatic cleanup
- Basic outputs only
- No validation

**After:**
- Uses `deploy-with-cleanup.sh` script
- Automatic cleanup of orphaned resources
- Automatic failed stack removal
- Deployment validation
- Enhanced deployment summary with all endpoints
- Saves complete deployment outputs as artifacts

**Key improvements:**
```yaml
# New deployment step
- name: Deploy to AWS with Smart Deployment
  run: ./scripts/deploy-with-cleanup.sh $STAGE

# New validation step
- name: Validate deployment
  run: ./scripts/validate-deployment.sh $STAGE
```

### 2. Web App Deploy Workflow (`.github/workflows/deploy-webapp.yml`)

**Before:**
- Manual multi-step deployment process
- No automatic cleanup
- Separate infrastructure and webapp deploy steps

**After:**
- Single smart deployment command
- Automatic cleanup
- Deployment validation
- Enhanced outputs with CloudFront distribution ID and S3 bucket name

**Key improvements:**
```yaml
# Simplified deployment
- name: Deploy with Smart Deployment (Infrastructure + WebApp)
  run: ./scripts/deploy-with-cleanup.sh $STAGE --webapp
```

## New Features in CI/CD

### 1. Automatic Resource Cleanup

Every deployment now automatically:
- ✅ Checks for orphaned DynamoDB tables
- ✅ Removes orphaned CloudWatch log groups
- ✅ Cleans up failed CloudFormation stacks
- ✅ Validates resources before deletion (safety checks)

### 2. Deployment Validation

After each deployment:
- ✅ Validates CloudFormation stack status
- ✅ Tests DynamoDB table health
- ✅ Checks Lambda function responsiveness
- ✅ Verifies AppSync API availability
- ✅ Validates CloudFront distribution (for webapp)

### 3. Enhanced Deployment Summaries

GitHub Actions summary now includes:
- All deployed resource names and ARNs
- GraphQL API URL and Key
- Web App URL (if deployed)
- CloudFront Distribution ID
- S3 Bucket name
- What changed in the deployment

### 4. Complete Deployment Artifacts

Each deployment saves a JSON file with all outputs:
```json
{
  "stage": "prod",
  "region": "us-east-1",
  "accountId": "842822459513",
  "tableName": "prod-main-table",
  "lambdaName": "prod-hello-world",
  "apiUrl": "https://xxx.appsync-api.us-east-1.amazonaws.com/graphql",
  "apiKey": "da2-xxxxxxxxxxxxx",
  "stateMachineArn": "arn:aws:states:...",
  "webappUrl": "https://xxx.cloudfront.net",
  "distributionId": "EXXXXXX",
  "s3BucketName": "prod-aws-boilerplate-webapp"
}
```

Artifact retention: 30 days

## Branch → Environment Mapping (Unchanged)

- `main` → **prod** environment
- `develop` → **test** environment
- `feature/*` → **dev** environment
- Pull requests → **test only** (no deployment)

## Workflow Triggers

### Infrastructure Deployment
- ✅ Push to main/develop/feature branches
- ✅ Pull requests (test only, no deploy)

### Web App Deployment
- ✅ Manual trigger (workflow_dispatch) - choose environment
- ✅ Push to any branch with changes to `packages/web-app/**`
- ✅ Changes to the workflow file itself

## Benefits

### For Developers

1. **No more manual cleanup** - Automatic detection and removal of orphaned resources
2. **Faster deployments** - No need to manually fix "Resource already exists" errors
3. **Better visibility** - Detailed deployment summaries in GitHub Actions
4. **Confidence** - Automatic validation ensures deployments are healthy

### For Operations

1. **Reduced failures** - Automatic cleanup prevents common deployment errors
2. **Better tracking** - Complete deployment outputs saved as artifacts
3. **Quick rollback** - Validation catches issues immediately
4. **Cost savings** - Automatic cleanup of orphaned resources

## Migration Guide

### No Action Required!

The workflows are **backward compatible**. Existing deployments will automatically use the new smart deployment system.

### What Happens on Next Push

1. Code is pushed to any branch
2. Linting and testing run as before
3. **NEW:** Cleanup script runs automatically
4. **NEW:** Orphaned resources are detected and removed
5. **NEW:** Failed stacks are cleaned up
6. Infrastructure is deployed
7. **NEW:** Deployment is validated
8. **NEW:** Complete outputs are saved as artifacts
9. Enhanced summary is generated

## Example Deployment Summary

When you push code, you'll see this in GitHub Actions:

```markdown
## Deployment Summary 🚀

✅ Successfully deployed to **dev** environment with smart deployment

### Deployed Resources
- **DynamoDB Table:** `dev-main-table`
- **Lambda Function:** `dev-hello-world`
- **GraphQL API URL:** `https://xxx.appsync-api.us-east-1.amazonaws.com/graphql`
- **GraphQL API Key:** `da2-xxxxxxxxxxxxx`
- **State Machine:** `arn:aws:states:us-east-1:123456789012:stateMachine:dev-hello-world-state-machine`
- **Region:** `us-east-1`

### Stack Names
- `dev-aws-boilerplate-database`
- `dev-aws-boilerplate-lambda`
- `dev-aws-boilerplate-appsync`
- `dev-aws-boilerplate-step-functions`

### What Changed 🎯
- ✅ Automatic cleanup of orphaned resources
- ✅ Failed stack detection and removal
- ✅ Deployment validation performed
- ✅ Complete deployment outputs saved
```

## Troubleshooting

### Workflow Fails at Cleanup Step

**Cause:** AWS credentials don't have permission to delete resources.

**Solution:** Ensure the IAM user/role has these permissions:
- `dynamodb:DeleteTable`
- `dynamodb:UpdateTable`
- `logs:DeleteLogGroup`
- `cloudformation:DeleteStack`

### Validation Step Shows Warnings

**Cause:** Some resources might not be fully ready.

**Solution:** This is expected. The deployment continues even if validation has minor issues. Check the specific resource in AWS Console.

### Deployment Artifacts Not Found

**Cause:** Deployment failed before outputs could be generated.

**Solution:** Check earlier steps in the workflow. The deployment likely failed during infrastructure creation.

## Testing the Updates

### Test in Dev First

1. Create a feature branch: `git checkout -b feature/test-pipeline`
2. Make a small change to any file
3. Push: `git push origin feature/test-pipeline`
4. Watch the GitHub Actions workflow run
5. Check the deployment summary in the Actions tab

### Verify Web App Deployment

1. Make a change to `packages/web-app/`
2. Push to your feature branch
3. Web app workflow should trigger automatically
4. Check the deployment summary for the CloudFront URL

## Files Changed

- `.github/workflows/deploy.yml` - Main infrastructure deployment
- `.github/workflows/deploy-webapp.yml` - Web app deployment
- `scripts/deploy-with-cleanup.sh` - Enhanced to output more information

## Next Steps

1. **Monitor first deployment** - Watch the next deployment to see the new features
2. **Check artifacts** - Download the deployment outputs JSON from GitHub Actions
3. **Review summaries** - Check the enhanced deployment summaries
4. **Celebrate** - No more manual cleanup needed! 🎉

## Questions?

See the following documentation:
- **[scripts/README.md](../scripts/README.md)** - Complete scripts documentation
- **[DEPLOYMENT_IMPROVEMENTS.md](../DEPLOYMENT_IMPROVEMENTS.md)** - Detailed improvements overview
- **[README.md](../README.md)** - Main project documentation
