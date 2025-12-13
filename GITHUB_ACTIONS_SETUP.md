# GitHub Actions Setup - Quick Start

## 🚀 Your CI/CD Pipeline is Ready!

The automated deployment pipeline has been created and pushed to your repository. Follow these steps to activate it.

---

## Step 1: Add AWS Credentials to GitHub Secrets

### Navigate to Repository Settings

1. Open your repository: https://github.com/richardforjoejnr/aws-cdk-boilerplate
2. Click **Settings** (top right)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**

### Add Required Secrets

#### Secret 1: AWS_ACCESS_KEY_ID

Click **New repository secret** and add:

- **Name**: `AWS_ACCESS_KEY_ID`
- **Value**: Your AWS access key ID

You can get this from:
```bash
# View your AWS credentials
cat ~/.aws/credentials
```

Or from the IAM user you created (`cdk-deployer`):
- AWS Console → IAM → Users → cdk-deployer → Security credentials → Access keys

#### Secret 2: AWS_SECRET_ACCESS_KEY

Click **New repository secret** and add:

- **Name**: `AWS_SECRET_ACCESS_KEY`
- **Value**: Your AWS secret access key

**Important**: This is the secret key that was shown only once when you created the access key. If you lost it, you'll need to create a new access key.

---

## Step 2: Test the Pipeline

### Option A: Make a Test Commit

```bash
# Make a small change
echo "# Testing CI/CD" >> README.md

# Commit and push
git add README.md
git commit -m "test: Verify GitHub Actions pipeline"
git push origin main
```

### Option B: Re-run the Latest Workflow

1. Go to your repository's **Actions** tab
2. Click on the latest workflow run
3. Click **Re-run all jobs**

---

## Step 3: Watch the Deployment

1. Go to **Actions** tab: https://github.com/richardforjoejnr/aws-cdk-boilerplate/actions
2. You'll see the **Deploy to AWS** workflow running
3. Click on it to see real-time logs
4. Wait ~5-6 minutes for deployment to complete

### Expected Output

You should see these jobs:
1. ✅ **Determine Environment** (~5 seconds)
2. ✅ **Lint and Test** (~1-2 minutes)
3. ✅ **Deploy to prod** (~3-4 minutes)
4. ✅ **Notify** (~5 seconds)

After successful deployment, you'll see a summary with:
- GraphQL API URL
- Deployed stack names
- AWS region and stage

---

## Step 4: Verify Deployment

### Check AWS Resources

```bash
# List CloudFormation stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE

# Test Lambda function
aws lambda invoke \
  --function-name prod-hello-world \
  --payload '{"name": "GitHub Actions"}' \
  response.json && cat response.json

# Test GraphQL API (use the URL from GitHub Actions output)
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"query":"query { hello(name: \"CI/CD\") }"}' \
  YOUR_API_URL
```

---

## How the Pipeline Works

### Automatic Deployments

| Branch | Environment | Triggered On |
|--------|-------------|--------------|
| `main` | **prod** | Every push to main |
| `develop` | **test** | Every push to develop |
| `feature/*` | **dev** | Every push to feature branches |
| Pull Request | N/A | Tests only, no deployment |

### Workflow Steps

```
Push to GitHub
    ↓
Determine Environment (based on branch)
    ↓
Lint & Test
    ├── ESLint
    ├── TypeScript compilation
    └── Unit tests
    ↓
Deploy to AWS (if not PR)
    ├── Install dependencies
    ├── Configure AWS credentials
    ├── Build application
    ├── CDK deploy
    └── Save outputs
    ↓
Notify
    └── Report status
```

---

## Current Deployment Status

### Production Environment (main branch)

**Deployed Resources**:
- ✅ DynamoDB table: `prod-main-table`
- ✅ Lambda function: `prod-hello-world`
- ✅ Step Functions: `prod-hello-world-state-machine`
- ✅ AppSync API: Deployed with API key

**AWS Account**: 842822459513
**Region**: us-east-1

---

## Managing Deployments

### Deploy to Different Environments

#### Deploy to Test
```bash
# Create develop branch (if not exists)
git checkout -b develop

# Make changes and push
git add .
git commit -m "feat: New feature for testing"
git push origin develop
```

This will automatically deploy to the **test** environment.

#### Deploy to Dev
```bash
# Create feature branch
git checkout -b feature/my-new-feature

# Make changes and push
git add .
git commit -m "feat: Work in progress"
git push origin feature/my-new-feature
```

This will automatically deploy to the **dev** environment.

### Manual Deployment (if needed)

```bash
# Local deployment (bypasses GitHub Actions)
STAGE=dev npm run deploy:dev
STAGE=test npm run deploy:test
STAGE=prod npm run deploy:prod
```

---

## Destroying Infrastructure

### Via GitHub Actions (Recommended)

1. Go to **Actions** tab
2. Select **Destroy AWS Infrastructure** workflow
3. Click **Run workflow**
4. Choose environment (dev/test/prod)
5. Type `DESTROY` to confirm
6. Click **Run workflow**

### Manually (if needed)

```bash
# Destroy dev environment
STAGE=dev npm run destroy

# Destroy test environment
STAGE=test npm run destroy

# Destroy prod environment (careful!)
STAGE=prod npm run destroy
```

---

## Optional: Set Up Environment Protection

For production safety, configure GitHub Environments:

### Create Production Environment

1. Go to **Settings** → **Environments**
2. Click **New environment**
3. Name: `prod`

### Add Protection Rules

1. Enable **Required reviewers**
2. Add team members who can approve deployments
3. (Optional) Enable **Wait timer**: 5 minutes
4. Set **Deployment branches**: Only `main`

Now production deployments will require manual approval!

---

## Troubleshooting

### Issue: "Workflow doesn't run"

**Check**:
1. Workflow file is in `.github/workflows/deploy.yml`
2. You pushed to a tracked branch (`main`, `develop`, or `feature/*`)
3. GitHub Actions is enabled (Settings → Actions → Allow all actions)

### Issue: "AWS credentials error"

**Solutions**:
1. Verify secrets are added: Settings → Secrets and variables → Actions
2. Check secret names match exactly: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
3. Verify IAM user has correct permissions

### Issue: "CDK bootstrap required"

**Solution**: Bootstrap AWS environment (one-time):
```bash
cd packages/infrastructure
npx cdk bootstrap aws://842822459513/us-east-1
```

### Issue: "Deployment fails"

**Steps**:
1. Check GitHub Actions logs for error details
2. Check CloudFormation console for stack status
3. Verify no resource conflicts (e.g., existing table names)
4. Try deploying locally first to debug

---

## Cost Monitoring

### GitHub Actions

- **Free tier**: 2,000 minutes/month (private repos)
- **Per deployment**: ~5-6 minutes
- **Max free deployments**: ~350/month

### AWS Costs

Same as manual deployment (see DEPLOYMENT_SUCCESS.md):
- **Estimated**: < $1/month for development usage
- **Free tier**: Covers most testing workloads

---

## Next Steps

1. ✅ **Add GitHub secrets** (you're here!)
2. ✅ **Test first deployment**
3. 📧 **Add notifications** (Slack/Email)
4. 🛡️ **Set up environment protection** (for prod)
5. 📊 **Add monitoring** (CloudWatch dashboards)
6. 🧪 **Add integration tests** (in pipeline)
7. 📈 **Track metrics** (deployment frequency, success rate)

---

## Additional Resources

- **[CI_CD_SETUP.md](./CI_CD_SETUP.md)** - Detailed pipeline documentation
- **[DEPLOYMENT_SUCCESS.md](./DEPLOYMENT_SUCCESS.md)** - Latest deployment info
- **[AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md)** - AWS credentials guide
- **[GitHub Actions Docs](https://docs.github.com/en/actions)** - Official documentation

---

## Summary

Your repository now has:
- ✅ Automated deployment on every commit
- ✅ Environment-specific deployments (dev/test/prod)
- ✅ Quality gates (linting, testing)
- ✅ Deployment artifacts and summaries
- ✅ Manual destroy workflow with safety checks

**All you need to do**: Add AWS credentials to GitHub Secrets and push a commit!

---

**Setup Time**: ~2-3 minutes
**Deployment Time**: ~5-6 minutes per environment
**Automation Level**: 100%
