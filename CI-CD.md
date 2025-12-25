# CI/CD Pipelines

This project uses GitHub Actions for automated deployment and infrastructure management.

## Available Pipelines

### 1. CI - Lint, Build & Test (`ci.yml`)

**Purpose:** Continuous Integration pipeline that validates code quality on every commit.

**Triggers:**
- **Automatic:** Push to any branch (`main`, `develop`, `feature/**`)
- **Automatic:** Pull requests to `main` or `develop`

**What it does:**
- ✅ Runs ESLint on all TypeScript code
- ✅ Builds all packages (functions, infrastructure, web-app)
- ✅ Runs tests (if any exist)
- ✅ Checks for TypeScript errors
- ✅ Validates code compiles without errors

**Workflow:**
1. Checkout code
2. Install dependencies
3. Run linter (`npm run lint`)
4. Build all packages (`npm run build`)
5. Run tests (`npm run test`)
6. Check TypeScript compilation

**Why it's important:**
- Catches errors before deployment
- Enforces code quality standards
- Validates all changes build successfully
- Fast feedback on pull requests

**Usage:**
Runs automatically on every push and PR. No manual action needed.

---

### 2. Deploy to AWS (`deploy.yml`)

**Purpose:** Main deployment pipeline that deploys all infrastructure and the web application.

**Triggers:**
- **Manual:** GitHub Actions UI (workflow_dispatch) - any environment
- **Automatic:** Push to `main` → production
- **Automatic:** Push to `develop` → test

**What it deploys:**
- ✅ DynamoDB tables
- ✅ Lambda functions
- ✅ AppSync GraphQL API
- ✅ Step Functions
- ✅ Web Application (CloudFront + S3)

**Workflow:**
1. Determines environment based on branch or manual input
2. Lints and tests code
3. Builds all packages
4. Runs smart deployment with cleanup (`deploy-with-cleanup.sh`)
5. Automatically rebuilds web app with updated API endpoints
6. Validates deployment
7. Uploads deployment outputs as artifacts

**Branch to Environment Mapping:**
- `main` → production (automatic)
- `develop` → test (automatic)
- `feature/**` → Use manual workflow_dispatch to deploy to dev

**Usage:**
```bash
# Automatic: Push to main (deploys to prod) or develop (deploys to test)
git push origin main
git push origin develop

# Manual: Use GitHub Actions UI to deploy any environment
# 1. Go to Actions → Deploy to AWS → Run workflow
# 2. Select branch and environment
# 3. Click Run workflow
```

**Key Features:**
- Pre-deployment cleanup of orphaned resources
- CloudFormation drift detection
- Automatic web app rebuild with correct API URLs
- Post-deployment validation
- Deployment outputs saved as artifacts

---

### 3. PR Preview Environment (`pr-preview.yml`)

**Purpose:** Automatically create and destroy isolated preview environments for pull requests.

**Triggers:**
- **Automatic:** When PR is opened, updated, or reopened → Deploys preview environment
- **Automatic:** When PR is closed or merged → Destroys preview environment

**What it does:**
- ✅ Creates isolated environment named `pr-{number}` (e.g., `pr-123`)
- ✅ Deploys full stack (infrastructure + web app)
- ✅ Posts comment on PR with deployment URLs
- ✅ Updates comment when PR is updated
- ✅ Destroys everything when PR is closed

**Preview Environment Naming:**
- PR #123 → Environment: `pr-123`
- Stacks: `pr-123-aws-boilerplate-database`, `pr-123-aws-boilerplate-appsync`, etc.

**Workflow:**

**Deploy (on PR open/update):**
1. Checkout PR code
2. Generate environment name from PR number
3. Deploy full stack using `deploy-with-cleanup.sh`
4. Comment on PR with URLs:
   - Web App URL
   - GraphQL API URL
   - Environment name

**Destroy (on PR close/merge):**
1. Identify environment from PR number
2. Destroy all CloudFormation stacks
3. Clean up orphaned resources
4. Comment on PR confirming destruction

**Benefits:**
- ✅ Test changes in isolation before merging
- ✅ Share live preview with team/stakeholders
- ✅ Catch integration issues early
- ✅ Automatic cleanup (no orphaned environments)
- ✅ Cost-effective (only exists during PR lifetime)

**Example PR Comment:**
```markdown
## 🚀 Preview Environment Deployed

Your preview environment is ready!

**Environment:** `pr-123`
**Web App:** https://xxx.cloudfront.net
**GraphQL API:** https://xxx.appsync-api.us-east-1.amazonaws.com/graphql

This environment will be automatically destroyed when the PR is merged or closed.
```

**Usage:**
1. Create a PR
2. Preview environment deploys automatically (takes ~5-10 minutes)
3. Test your changes in the preview environment
4. When PR is merged/closed, environment is destroyed automatically

**Cost Considerations:**
- Each preview environment incurs AWS costs
- Environments are destroyed automatically to minimize costs
- Consider limiting to specific branches if needed

---

### 4. Destroy AWS Infrastructure (`destroy.yml`)

**Purpose:** Safely destroy all AWS resources for a specific environment.

**Triggers:**
- **Manual only:** GitHub Actions UI (workflow_dispatch)

**Safety Features:**
- ⚠️ Requires manual confirmation
- Must type "DESTROY" to proceed
- Shows what will be deleted
- Environment selection (dev/test/prod)

**What it destroys:**
- All CloudFormation stacks
- DynamoDB tables
- Lambda functions
- AppSync API
- Step Functions
- Web app (S3 + CloudFront)
- CloudWatch log groups

**Usage:**
1. Go to GitHub Actions tab
2. Select "Destroy AWS Infrastructure"
3. Click "Run workflow"
4. Select environment (dev/test/prod)
5. Type "DESTROY" in confirmation field
6. Click "Run workflow"

**⚠️ Warning:** This action is irreversible. All data will be lost.

---

## Environment Configuration

### AWS Credentials

Pipelines use GitHub Secrets for AWS authentication:

**Required Secrets:**
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key

**Setup:**
1. Go to repository Settings → Secrets and variables → Actions
2. Add the above secrets
3. Ensure IAM user has necessary permissions

### Environment Variables

Set in the workflow files:

```yaml
env:
  NODE_VERSION: '18'
  AWS_REGION: 'us-east-1'
```

---

## Deployment Process Details

### Smart Deployment Script

All deployments use `deploy-with-cleanup.sh` which:

1. **Pre-Deployment Checks**
   - Validates AWS credentials
   - Cleans up orphaned resources
   - Detects CloudFormation drift
   - Reports potential issues

2. **Build Phase**
   - Compiles TypeScript for all packages
   - Bundles Lambda functions
   - Builds web app with Vite

3. **Deploy Phase**
   - Deploys CloudFormation stacks in order
   - Waits for each stack to complete
   - Handles errors gracefully

4. **Post-Deployment**
   - Rebuilds web app with updated API URLs
   - Invalidates CloudFront cache
   - Validates deployment
   - Saves deployment outputs

### Deployment Outputs

After each deployment, outputs are saved to:
- `.deployment-outputs-{stage}.json`
- GitHub Actions artifacts

**Example outputs:**
```json
{
  "stage": "dev",
  "region": "us-east-1",
  "accountId": "123456789012",
  "tableName": "dev-main-table",
  "lambdaName": "dev-hello-world",
  "apiUrl": "https://xxx.appsync-api.us-east-1.amazonaws.com/graphql",
  "apiKey": "da2-xxxxxxxxxxxx",
  "stateMachineArn": "arn:aws:states:...",
  "webappUrl": "https://xxx.cloudfront.net",
  "distributionId": "EXXXXXX",
  "s3BucketName": "dev-aws-boilerplate-webapp"
}
```

---

## Manual Deployments

You can also deploy manually from your local machine:

### Deploy Everything (Infrastructure + Web App)

```bash
# Development
npm run deploy:dev:webapp

# Test
npm run deploy:test:webapp

# Production
npm run deploy:prod:webapp
```

### Deploy Web App Only (Fast)

```bash
# Development
npm run deploy:webapp:dev

# Test
npm run deploy:webapp:test

# Production
npm run deploy:webapp:prod
```

### Destroy Everything

```bash
# Development
npm run destroy:dev

# Test
npm run destroy:test

# Production
npm run destroy:prod
```

---

## Troubleshooting Pipelines

### Build Fails

**Check:**
1. GitHub Actions logs for specific error
2. Ensure all dependencies are in package.json
3. Verify TypeScript compiles locally: `npm run build`

**Common Errors:**
- `Cannot find name 'ImportMetaEnv'` → `vite-env.d.ts` missing or not committed
- `Module not found` → Missing dependency in package.json

### Deployment Fails

**Check:**
1. CloudFormation console for stack status
2. AWS credentials are valid
3. IAM permissions are sufficient

**Common Errors:**
- `Resource already exists` → Run cleanup script manually
- `Stack is in UPDATE_ROLLBACK_COMPLETE` → Delete failed stack manually

### Web App Shows Old API URL

**This should no longer happen** due to automatic rebuild fix.

If it still occurs:
1. Check CloudFront cache invalidation completed
2. Manually run: `./scripts/deploy-webapp.sh dev`
3. Hard refresh browser (Ctrl+Shift+R)

---

## Pipeline Best Practices

### 1. Feature Development Workflow

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes
# ... code changes ...

# 3. Push to trigger CI checks (lint, build, test)
git push origin feature/my-feature
# → CI pipeline runs automatically

# 4. Create PR to develop
# → CI pipeline runs on PR
# → PR Preview environment deploys automatically (takes ~5-10 min)
# → Bot comments on PR with preview URLs
# → Test your changes in the preview environment

# 5. Get PR approved and merge
# → Preview environment is automatically destroyed
# → Merge to develop when approved

# 6. Push to develop triggers automatic deployment to test
git push origin develop
# → Deploy pipeline runs automatically for test environment

# 7. After testing, merge to main for production
git checkout main
git merge develop
git push origin main
# → Deploy pipeline runs automatically for production
```

### 2. Testing Changes

**Test locally first:**
```bash
npm run build
npm run lint
```

**Test deployment to dev:**
```bash
npm run deploy:dev:webapp
```

**Verify:**
- All stacks deployed successfully
- Web app loads without errors
- CRUD operations work

### 3. Monitoring Deployments

**GitHub Actions:**
1. Go to repository → Actions tab
2. View workflow runs
3. Check logs for each step

**AWS CloudFormation:**
1. Open CloudFormation console
2. View stack events
3. Check for errors or drift

**Application Logs:**
```bash
# Lambda logs
aws logs tail /aws/lambda/dev-hello-world --follow

# AppSync logs
aws logs tail /aws/appsync/apis/{api-id} --follow
```

---

## Security Considerations

### Secrets Management

- ✅ AWS credentials stored in GitHub Secrets (encrypted)
- ✅ API keys not committed to repository
- ✅ Environment variables injected at build time
- ❌ Never commit `.env` files with real credentials

### IAM Permissions

**Minimum required permissions for deployment:**
- CloudFormation: Full access
- DynamoDB: Create/update/delete tables
- Lambda: Create/update functions
- AppSync: Create/update APIs
- S3: Create buckets, upload files
- CloudFront: Create distributions, invalidate cache
- IAM: Create roles for Lambda/AppSync
- CloudWatch: Create log groups

### Production Safety

**Protect production:**
1. Enable branch protection on `main`
2. Require pull request reviews
3. Require CI checks to pass
4. Use environment secrets for production

**Destroy confirmation:**
- Destroy pipeline requires typing "DESTROY"
- Manual trigger only (no automatic destruction)

---

## Pipeline Maintenance

### Updating Dependencies

```bash
# Update CDK
npm install -g aws-cdk
cdk --version

# Update project dependencies
npm update
npm run build
npm run test
```

### Updating Node.js Version

1. Update `NODE_VERSION` in workflow files
2. Update `engines` in package.json
3. Update Lambda runtime in stack files
4. Test locally before deploying

### Adding New Environments

1. Add environment to `cdk.json`:
   ```json
   "staging": {
     "stage": "staging",
     "isProdLike": true
   }
   ```

2. Add npm scripts in `package.json`
3. Update workflow environment choices
4. Deploy: `STAGE=staging npm run deploy`

---

## Comparison: Old vs New Pipeline Setup

### ❌ Old (3 Pipelines)

1. **deploy.yml** - Infrastructure only
2. **deploy-webapp.yml** - Infrastructure + Web app
3. **destroy.yml** - Destroy resources

**Problems:**
- No CI pipeline for quality checks
- Confusing to have two deployment pipelines
- Infrastructure-only deployment would leave web app with wrong API URLs
- Required manual web app rebuild after infrastructure changes
- Deployments triggered on every feature branch push

### ✅ New (4 Pipelines)

1. **ci.yml** - Lint, build, test on every commit
2. **deploy.yml** - Deploy to dev/test/prod
3. **pr-preview.yml** - Automatic PR preview environments
4. **destroy.yml** - Destroy resources

**Benefits:**
- ✅ Fast feedback on code quality (CI runs on every push)
- ✅ Single deployment pipeline (no confusion)
- ✅ Web app always has correct API URLs
- ✅ Automatic PR preview environments for testing
- ✅ Preview environments auto-destroyed when PR closes
- ✅ Automatic deployments only for main/develop (safer)
- ✅ Manual deployment for feature branches (more control)
- ✅ Simplified workflow
- ✅ Better separation of concerns
- ✅ Share live previews with team/stakeholders

---

## Quick Reference

### Deploy Commands

| Command | Environment | What it Deploys |
|---------|-------------|-----------------|
| `npm run deploy:dev:webapp` | Development | Everything |
| `npm run deploy:test:webapp` | Test | Everything |
| `npm run deploy:prod:webapp` | Production | Everything |
| `npm run deploy:webapp:dev` | Development | Web app only |
| `npm run destroy:dev` | Development | Destroys everything |

### Useful Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/deploy-with-cleanup.sh dev --webapp` | Smart deployment |
| `./scripts/cleanup-orphaned-resources.sh dev` | Clean orphaned resources |
| `./scripts/fix-cloudformation-drift.sh dev` | Detect drift |
| `./scripts/configure-webapp.sh dev` | Generate web app config |
| `./scripts/validate-deployment.sh dev` | Validate deployment |

### CloudFormation Stacks

| Stack Name | Resources |
|------------|-----------|
| `{stage}-aws-boilerplate-database` | DynamoDB tables |
| `{stage}-aws-boilerplate-lambda` | Lambda functions |
| `{stage}-aws-boilerplate-appsync` | GraphQL API |
| `{stage}-aws-boilerplate-step-functions` | State machines |
| `{stage}-aws-boilerplate-web-app` | CloudFront + S3 |

---

## Support

### Getting Help

1. Check logs in GitHub Actions
2. Review CloudFormation events
3. Check `ARCHITECTURE.md` for system overview
4. Review deployment outputs

### Common Issues

See [ARCHITECTURE.md - Troubleshooting](./ARCHITECTURE.md#troubleshooting) section.
