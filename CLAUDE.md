# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AWS serverless boilerplate built with TypeScript, AWS CDK, AppSync GraphQL API, DynamoDB, Lambda, Step Functions, and React. Features multi-environment support (dev/test/prod), monorepo architecture with npm workspaces, and GitHub Actions CI/CD with PR preview environments.

## Common Commands

### Build & Test
```bash
npm install                    # Install all dependencies (monorepo)
npm run build                  # Build all packages (TypeScript compilation)
npm run test                   # Run tests across all packages
npm run lint                   # Lint TypeScript files
npm run format                 # Format code with Prettier
```

### Deployment

**Smart Deployment (Recommended):**
```bash
npm run deploy:dev             # Deploy to dev (with auto-cleanup)
npm run deploy:test            # Deploy to test (with auto-cleanup)
npm run deploy:prod            # Deploy to prod (with auto-cleanup)
npm run deploy:dev:webapp      # Deploy dev + web app
```

**Standard Deployment:**
```bash
cd packages/infrastructure
STAGE=dev npx cdk deploy --all # Deploy specific environment
npx cdk deploy {stack-name}    # Deploy single stack
npx cdk diff                   # Preview changes
npx cdk synth                  # Synthesize CloudFormation
```

**Web App Only:**
```bash
npm run deploy:webapp:dev      # Deploy frontend to S3+CloudFront
npm run webapp:config:dev      # Generate .env from CDK outputs
npm run webapp:dev             # Local dev server
```

**Jira Dashboard:**
```bash
npm run jira:deploy:dev        # Deploy Jira dashboard stack
npm run jira:destroy:dev       # Destroy Jira dashboard stack
```

### Destroy & Cleanup
```bash
npm run destroy:dev            # Destroy all dev stacks
npm run cleanup:orphaned:dev   # Clean orphaned resources (DynamoDB, logs)
npm run cleanup:failed:dev     # Remove failed CloudFormation stacks
npm run validate:dev           # Validate deployment health
```

### Drift Detection
```bash
npm run drift:check:dev        # Detect CloudFormation drift
npm run drift:fix:dev          # Fix drift and redeploy
```

### CDK Bootstrap
```bash
# First-time setup only (once per account/region)
cd packages/infrastructure
npx cdk bootstrap
```

## Architecture

### Monorepo Structure
```
packages/
├── infrastructure/    # CDK stacks (TypeScript)
│   ├── bin/app.ts    # CDK app entry - defines all stacks
│   └── lib/          # Stack definitions
├── functions/        # Lambda functions (TypeScript, ESM)
│   └── src/          # Individual function directories
└── web-app/          # React frontend (Vite)
    └── src/          # HTML/JS/CSS (not React despite name)
```

### CDK Stacks (Deployment Order)

Stacks are deployed in dependency order by CDK. All stacks are defined in `packages/infrastructure/bin/app.ts`:

1. **DatabaseStack** (`database-stack.ts`)
   - DynamoDB tables with PAY_PER_REQUEST (dev) or PROVISIONED (prod)
   - Global Secondary Indexes (GSI1, GSI2)
   - DynamoDB Streams enabled
   - Point-in-time recovery (prod)
   - Auto-scaling (prod)

2. **LambdaStack** (`lambda-stack.ts`)
   - Hello World Lambda (demo function)
   - Node.js 20.x runtime
   - ES Modules format
   - Environment variables injected: `TABLE_NAME`, `STAGE`

3. **AppSyncStack** (`appsync-stack.ts`)
   - GraphQL API with schema in `packages/infrastructure/lib/graphql/schema.graphql`
   - DynamoDB resolvers (VTL templates)
   - Lambda resolvers
   - API Key + IAM authorization
   - CRUD operations: createItem, getItem, updateItem, deleteItem, listItems

4. **StepFunctionsStack** (`step-functions-stack.ts`)
   - State machine orchestration
   - Lambda integrations
   - Error handling and retries

5. **JiraDashboardStack** (`jira-dashboard-stack.ts`)
   - Complete Jira analytics system
   - CSV upload processing with Step Functions
   - API Gateway REST API
   - 12 Lambda functions for data processing
   - DynamoDB tables: uploads, issues
   - S3 bucket with event notifications
   - High-memory Lambdas (3008 MB) for batch processing

6. **WebAppStack** (`web-app-stack.ts`)
   - S3 bucket for static hosting
   - CloudFront CDN distribution
   - Automatic deployment from `packages/web-app/dist/`
   - Only deployed when `DEPLOY_WEBAPP=true` or `--webapp` flag

### Environment Configuration

Environments are controlled via `STAGE` environment variable and CDK context in `bin/app.ts`:

- **dev**: Pay-per-request, no deletion protection, DESTROY removal policy
- **test**: Provisioned capacity, deletion protection, RETAIN removal policy
- **prod**: Provisioned capacity, deletion protection, RETAIN removal policy, auto-scaling

**Environment detection:**
```typescript
const isProdLike = stage === 'prod' || stage === 'test';
```

**PR Preview Environments:**
- Named `pr-{number}` (e.g., `pr-123`)
- Treated as dev-like environments
- Auto-created/destroyed by `.github/workflows/pr-preview.yml`

### Lambda Functions

All functions are in `packages/functions/src/` with ES Modules format:

**Main Functions:**
- `hello-world/` - Demo Lambda with DynamoDB integration
- `dynamodb-stream-handler/` - Processes DynamoDB stream events

**Jira Dashboard Functions (12 total):**
- `jira-csv-processor/` - Initial CSV upload (3008 MB, 15 min timeout)
- `jira-process-batch/` - Batch processing via Step Functions (500 rows/batch)
- `jira-start-processing/` - S3 trigger for Step Functions
- `jira-finalize-upload/` - Workflow completion
- `jira-get-upload-url/` - Presigned S3 URLs
- `jira-get-dashboard-data/` - Aggregated metrics
- `jira-get-historical-data/` - Trend analysis
- `jira-list-uploads/` - List uploads
- `jira-delete-upload/` - Delete upload and data
- `jira-get-upload-status/` - Check processing status
- `get-costs/` - AWS Cost Explorer integration

**Build Process:**
- Functions are compiled from TypeScript to JavaScript
- CDK uses `esbuild` for bundling
- Output: `packages/functions/dist/{function-name}/`

### GraphQL Schema

Located at `packages/infrastructure/lib/graphql/schema.graphql`. Uses AppSync VTL resolvers for DynamoDB operations.

**Key patterns:**
- Single-table design with composite keys (`pk`, `sk`)
- VTL utilities: `$util.autoId()`, `$util.time.nowISO8601()`, `$util.dynamodb.toDynamoDBJson()`
- Request/response mapping templates for DynamoDB transformations

### Web Application

**Not React** - despite the directory name, `packages/web-app/src/` contains vanilla HTML/CSS/JavaScript applications:
- `index.html` - Main landing page
- `jira-dashboard/` - Jira analytics dashboard with Chart.js

**Build:**
- Vite is used for bundling
- Environment variables from `.env` files (generated by `scripts/configure-webapp.sh`)
- Outputs to `packages/web-app/dist/`

**Configuration:**
```bash
# Generate .env from CDK outputs
./scripts/configure-webapp.sh dev

# Creates .env with:
VITE_STAGE=dev
VITE_AWS_REGION=us-east-1
VITE_GRAPHQL_API_URL=https://...
VITE_GRAPHQL_API_KEY=da2-...
```

## Important Scripts

All scripts are in `scripts/` directory:

**Deployment:**
- `deploy-with-cleanup.sh {stage}` - Smart deployment with pre-checks, cleanup, and validation
- `deploy-webapp.sh {stage}` - Deploy frontend only (faster iteration)
- `configure-webapp.sh {stage}` - Generate web app .env from CloudFormation outputs

**Cleanup:**
- `cleanup-orphaned-resources.sh {stage}` - Remove non-CloudFormation resources (DynamoDB tables, CloudWatch logs)
- `cleanup-failed-stacks.sh {stage}` - Delete failed stacks
- `cleanup-all-pr-environments.sh` - Bulk cleanup of all PR environments

**Drift Management:**
- `fix-cloudformation-drift.sh {stage}` - Detect drift between CloudFormation and actual AWS state
- `fix-drift-and-redeploy.sh {stage}` - Fix drift and redeploy

**Data Management:**
- `backup-table.sh {stage} {table-name}` - Backup DynamoDB table to JSON
- `restore-table.sh {stage} {table-name}` - Restore DynamoDB table from backup
- `import-all-tables.sh {stage}` - Import existing tables into CloudFormation management

**Monitoring:**
- `validate-deployment.sh {stage}` - Verify deployment health
- `monitor-dynamodb-costs.sh {stage}` - DynamoDB cost analysis

## Key Conventions

### Naming
- **Stacks**: `{stage}-aws-boilerplate-{service}` (e.g., `dev-aws-boilerplate-database`)
- **Resources**: `{stage}-{resource-name}` (e.g., `dev-main-table`)
- **PR Environments**: `pr-{number}` (e.g., `pr-123-aws-boilerplate-database`)

### Tags
All resources are tagged:
- `Project: AWS-Boilerplate`
- `Environment: {stage}`
- `ManagedBy: CDK`

### Single-Table Design (DynamoDB)
Use composite keys for flexible access patterns:
```
pk (partition key) | sk (sort key) | attributes
{uuid}            | ITEM          | name, description, createdAt, updatedAt
```

### CloudFormation Drift
**What is drift?** When actual AWS resources differ from CloudFormation state.

**Common causes:**
- Manual changes via AWS console
- Resources deleted outside CloudFormation
- Orphaned resources from failed deployments

**Prevention:**
- Always use `deploy-with-cleanup.sh` (auto-detects drift)
- Run `drift:check` before manual deployments
- Use scripts for all resource operations

## CI/CD (GitHub Actions)

### Workflows

1. **`.github/workflows/deploy.yml`**
   - Manual deployment to dev/test/prod
   - Runs drift detection and cleanup
   - Saves deployment outputs as artifacts

2. **`.github/workflows/destroy.yml`**
   - Manual destruction of environments
   - Requires typing "DESTROY" to confirm
   - Production warning

3. **`.github/workflows/pr-preview.yml`**
   - Auto-creates `pr-{number}` environment on PR open/update
   - Backs up/restores DynamoDB data between updates
   - Posts deployment URLs in PR comments
   - Auto-destroys on PR close

4. **`.github/workflows/ci.yml`**
   - Runs on all PRs
   - Linting, testing, type checking

### GitHub Secrets Required
- `AWS_ACCESS_KEY_ID` - IAM access key
- `AWS_SECRET_ACCESS_KEY` - IAM secret key
- `AWS_REGION` - Default region (e.g., us-east-1)

## Development Workflow

### Adding a New Lambda Function

1. Create function directory:
```bash
mkdir packages/functions/src/my-function
```

2. Create handler with ES Modules:
```typescript
// packages/functions/src/my-function/index.ts
export const handler = async (event: any) => {
  // Function logic
  return { statusCode: 200, body: JSON.stringify({ message: 'Success' }) };
};
```

3. Add to appropriate stack (e.g., `LambdaStack`):
```typescript
const myFunction = new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('../../functions/dist/my-function'),
  environment: {
    TABLE_NAME: props.mainTable.tableName,
    STAGE: stage,
  },
});
```

4. Build and deploy:
```bash
npm run build
npm run deploy:dev
```

### Adding a GraphQL Operation

1. Update schema in `packages/infrastructure/lib/graphql/schema.graphql`
2. Create resolver in `AppSyncStack`
3. Write VTL request/response mapping templates
4. Deploy: `npm run deploy:dev`

### Modifying Infrastructure

1. Edit CDK stack files in `packages/infrastructure/lib/`
2. Preview changes: `cd packages/infrastructure && npx cdk diff`
3. Deploy: `npm run deploy:dev`

### Frontend Changes

For faster iteration on frontend-only changes:
```bash
npm run deploy:webapp:dev  # Deploy frontend only (skips infrastructure)
```

## Troubleshooting

### "Resource already exists" Error
Run cleanup before deployment:
```bash
npm run cleanup:orphaned:dev
npm run cleanup:failed:dev
```

### "Stack is in UPDATE_ROLLBACK_COMPLETE"
Delete failed stack:
```bash
npm run cleanup:failed:dev
```

### Web App Shows Old Version
CloudFront cache invalidation is automatic on deployment, but can take 5-10 minutes. Manual invalidation:
```bash
aws cloudfront create-invalidation --distribution-id {id} --paths "/*"
```

### GraphQL "Not Authorized" Error
API key may be expired (365 day lifetime). Redeploy AppSync stack to generate new key:
```bash
cd packages/infrastructure
STAGE=dev npx cdk deploy dev-aws-boilerplate-appsync
```

### Build Failures
```bash
# Clean and rebuild
rm -rf node_modules package-lock.json
rm -rf packages/*/node_modules packages/*/dist
npm install
npm run build
```

### Drift Detected
Fix drift automatically:
```bash
npm run drift:fix:dev  # Detects drift, imports resources, redeploys
```

## Testing

### Unit Tests
```bash
npm run test                           # Run all tests
npm run test --workspace=@aws-boilerplate/functions  # Test specific package
```

### Manual Testing

**Test Lambda directly:**
```bash
aws lambda invoke \
  --function-name dev-hello-world \
  --payload '{"name": "Test"}' \
  response.json && cat response.json
```

**Test GraphQL API:**
```bash
# Get API details
./scripts/configure-webapp.sh dev
cat packages/web-app/.env.dev

# Test with curl
curl -X POST "$VITE_GRAPHQL_API_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $VITE_GRAPHQL_API_KEY" \
  -d '{"query": "query { listItems { pk name } }"}'
```

**Check CloudWatch Logs:**
```bash
aws logs tail /aws/lambda/dev-hello-world --follow
```

## Cost Optimization

- **Dev environment**: Pay-per-request billing, minimal resources
- **Prod environment**: Provisioned capacity with auto-scaling
- **PR environments**: Auto-cleanup on PR close
- **Orphaned resource cleanup**: Automated scripts prevent zombie resources
- **S3 lifecycle policies**: Glacier archival for old data (prod)

## Important Notes

- **ES Modules**: All Lambda functions use ES Modules (`type: "module"` in package.json)
- **Node.js 20.x**: All Lambda functions use Node.js 20.x runtime
- **TypeScript strict mode**: Enabled across all packages
- **Monorepo**: Use `npm run {script} --workspace=@aws-boilerplate/{package}` for package-specific commands
- **CDK Context**: Stage is set via `STAGE` environment variable, not CDK context parameters
- **Web App Deployment**: Only deployed with explicit `DEPLOY_WEBAPP=true` or `--webapp` flag

## Useful AWS CLI Commands

```bash
# List all stacks for an environment
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE

# Describe specific stack
aws cloudformation describe-stacks --stack-name dev-aws-boilerplate-database

# Get stack outputs
aws cloudformation describe-stacks --stack-name dev-aws-boilerplate-appsync \
  --query 'Stacks[0].Outputs'

# Check DynamoDB table
aws dynamodb describe-table --table-name dev-main-table

# List Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `dev-`)].FunctionName'
```

## AWS Authentication

Authentication is configured using IAM access keys for both local development and GitHub Actions CI/CD.

**Current Setup:**
- **AWS Account:** `<your-account-id>` (set via `aws configure` / `AWS_ACCOUNT_ID` env var; do not commit real account IDs)
- **IAM User:** cdk-deployer
- **Region:** us-east-1

**Local Development:**
- Credentials stored in `~/.aws/credentials`
- Verify: `aws sts get-caller-identity`

**GitHub Actions:**
- Uses repository secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Configured in `.github/workflows/deploy.yml`

**See:** `AWS_AUTHENTICATION_GUIDE.md` for complete authentication documentation, including:
- Credential chain and authentication flow
- IAM permissions required for each CDK stack
- Security best practices and credential rotation
- Troubleshooting authentication issues
- OIDC setup (recommended for production)

## Additional Documentation

- `README.md` - Quick start and feature overview
- `ARCHITECTURE.md` - Detailed architecture documentation (1100+ lines)
- `TECH_STACK.md` - Complete technology stack reference
- `AWS_AUTHENTICATION_GUIDE.md` - Complete AWS authentication and IAM guide
- `scripts/README.md` - Deployment scripts documentation
- `packages/infrastructure/lib/` - CDK stack implementation details
