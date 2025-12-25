# Deployment Scripts

This directory contains automated deployment and maintenance scripts for the AWS Boilerplate project.

## Overview

These scripts handle common deployment issues automatically:
- ✅ Cleanup orphaned resources (DynamoDB tables, CloudWatch logs)
- ✅ Remove failed CloudFormation stacks
- ✅ Validate AWS credentials
- ✅ Build and deploy infrastructure
- ✅ Generate deployment outputs
- ✅ Configure web applications

## Scripts

### 1. `deploy-with-cleanup.sh` - Smart Deployment (Recommended)

**The main deployment script that handles everything automatically.**

```bash
# Deploy to dev with automatic cleanup
npm run deploy:dev

# Deploy to production with automatic cleanup
npm run deploy:prod

# Deploy with web app included
npm run deploy:dev:webapp

# Skip automatic cleanup (not recommended)
./scripts/deploy-with-cleanup.sh dev --skip-cleanup
```

**What it does:**
1. Validates AWS credentials
2. Runs pre-deployment cleanup (orphaned resources, failed stacks)
3. Builds all packages
4. Deploys infrastructure
5. Generates deployment summary with all endpoints
6. Saves outputs to `.deployment-outputs-{stage}.json`

### 2. `cleanup-orphaned-resources.sh` - Clean Orphaned Resources

Removes AWS resources that exist outside CloudFormation management and would cause deployment failures.

```bash
# Cleanup orphaned resources for dev
npm run cleanup:orphaned:dev

# Or run directly
./scripts/cleanup-orphaned-resources.sh prod
```

**What it cleans:**
- DynamoDB tables not managed by CloudFormation
- CloudWatch log groups not managed by CloudFormation
- Failed CloudFormation stacks

**Safety features:**
- ✅ Checks if resources are CloudFormation-managed before deletion
- ✅ Skips DynamoDB tables with data
- ✅ Color-coded output for easy visibility

### 3. `cleanup-failed-stacks.sh` - Remove Failed Stacks

Interactive script to remove failed CloudFormation stacks.

```bash
npm run cleanup:failed:prod

# Or run directly
./scripts/cleanup-failed-stacks.sh dev
```

**Stack statuses removed:**
- CREATE_FAILED
- ROLLBACK_FAILED
- ROLLBACK_COMPLETE
- DELETE_FAILED
- UPDATE_ROLLBACK_FAILED
- UPDATE_ROLLBACK_COMPLETE

### 4. `deploy-webapp.sh` - Deploy Web Application

Builds and deploys only the web application.

```bash
npm run deploy:webapp:dev
npm run deploy:webapp:prod

# Or run directly
./scripts/deploy-webapp.sh test
```

### 5. `configure-webapp.sh` - Configure Web App

Generates environment configuration for the web application with API endpoints.

```bash
npm run webapp:config:dev
npm run webapp:config:prod

# Or run directly
./scripts/configure-webapp.sh test
```

**Generates:** `packages/web-app/.env.{stage}` with:
- GraphQL API URL
- GraphQL API Key
- GraphQL API ID
- AWS Region

## Common Deployment Scenarios

### First Time Deployment

```bash
# Deploy everything to dev
npm run deploy:dev:webapp
```

### Update Infrastructure Only

```bash
npm run deploy:dev
```

### Deploy to Production

```bash
# Always use the smart deployment script for production
npm run deploy:prod
```

### Fix Deployment Issues

If you encounter errors like "Resource already exists":

```bash
# Clean up orphaned resources first
npm run cleanup:orphaned:prod

# Then deploy
npm run deploy:prod
```

### After Destroying Stacks

If you ran destroy commands and have leftover resources:

```bash
# Clean up everything
npm run cleanup:orphaned:dev
npm run cleanup:failed:dev

# Then deploy fresh
npm run deploy:dev:webapp
```

## Deployment Output Files

Each deployment generates a JSON file with all outputs:

```json
{
  "stage": "dev",
  "region": "us-east-1",
  "accountId": "123456789012",
  "tableName": "dev-main-table",
  "lambdaName": "dev-hello-world",
  "apiUrl": "https://xxx.appsync-api.us-east-1.amazonaws.com/graphql",
  "apiKey": "da2-xxxxxxxxxxxxx",
  "stateMachineArn": "arn:aws:states:us-east-1:123456789012:stateMachine:dev-hello-world-state-machine",
  "webappUrl": "https://xxx.cloudfront.net"
}
```

File location: `.deployment-outputs-{stage}.json`

## Environment Variables

All scripts support these environment variables:

- `AWS_REGION` - AWS region to deploy to (default: us-east-1)
- `STAGE` - Deployment stage (dev/test/prod)
- `DEPLOY_WEBAPP` - Include web app in deployment (true/false)

## Troubleshooting

### "Resource already exists" Error

**Problem:** A resource exists outside CloudFormation management.

**Solution:**
```bash
npm run cleanup:orphaned:dev
```

### "Stack in DELETE_FAILED state"

**Problem:** Failed stack is blocking new deployment.

**Solution:**
```bash
npm run cleanup:failed:dev
```

### "Deletion protection enabled"

**Problem:** Production DynamoDB table has deletion protection.

**Solution:** The cleanup script automatically disables deletion protection for empty tables.

### Web App Shows 403 Error

**Problem:** CloudFront can't access S3 bucket.

**Solution:** Already fixed in the CDK stack (using S3BucketOrigin instead of deprecated S3Origin).

## Best Practices

1. **Always use smart deployment** (`deploy:dev`, `deploy:prod`) for hassle-free deployments
2. **For production**, review cleanup actions before confirming
3. **Check deployment outputs** in the generated JSON file
4. **Configure web app** after infrastructure deployment
5. **Use cleanup scripts** when switching between branches or after failed deployments

## Migration from Old Deployment Method

**Before:**
```bash
npm run deploy:prod  # Would fail with orphaned resources
```

**Now:**
```bash
npm run deploy:prod  # Automatically handles cleanup and deploys smoothly
```

The new scripts are **backward compatible** - all old commands still work, but now with automatic cleanup!
