# CI/CD Pipeline Setup Guide

## Overview

This repository includes automated CI/CD pipelines using GitHub Actions that deploy infrastructure to AWS on every commit.

## Pipeline Architecture

### Deployment Pipeline

**Workflow File**: `.github/workflows/deploy.yml`

**Triggers**:
- Push to `main` branch → Deploys to **production**
- Push to `develop` branch → Deploys to **test**
- Push to `feature/*` branches → Deploys to **dev**
- Pull requests → Runs tests only (no deployment)

**Pipeline Stages**:
1. **Determine Environment** - Decides which AWS environment to deploy to
2. **Lint and Test** - Runs ESLint, tests, and TypeScript compilation
3. **Deploy** - Deploys to AWS using CDK
4. **Notify** - Reports deployment status

---

## Setup Instructions

### 1. Add AWS Credentials to GitHub Secrets

#### Navigate to Repository Settings
1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

#### Add Required Secrets

**Secret 1: AWS_ACCESS_KEY_ID**
- Name: `AWS_ACCESS_KEY_ID`
- Value: Your AWS access key (e.g., `AKIAIOSFODNN7EXAMPLE`)

**Secret 2: AWS_SECRET_ACCESS_KEY**
- Name: `AWS_SECRET_ACCESS_KEY`
- Value: Your AWS secret key

**Optional Secret: AWS_ACCOUNT_ID** (for additional validation)
- Name: `AWS_ACCOUNT_ID`
- Value: `842822459513`

#### Create IAM User for GitHub Actions

If you haven't already created an IAM user for deployments:

```bash
# Create IAM user
aws iam create-user --user-name github-actions-deployer

# Attach AdministratorAccess policy (or use custom policy from AWS_ACCESS_SETUP.md)
aws iam attach-user-policy \
  --user-name github-actions-deployer \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Create access key
aws iam create-access-key --user-name github-actions-deployer
```

---

### 2. Configure GitHub Environments (Optional but Recommended)

#### Create Environments for Protection Rules

1. Go to **Settings** → **Environments**
2. Click **New environment**
3. Create three environments:
   - `dev`
   - `test`
   - `prod`

#### Production Environment Protection

For the `prod` environment:
1. Enable **Required reviewers**
2. Add team members who can approve production deployments
3. Enable **Wait timer** (optional) - e.g., 5 minutes before deployment
4. Add **Deployment branches** rule - only `main` branch

#### Environment Secrets (Optional)

If you use different AWS accounts for each environment:

For each environment, add:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (if different from default)

---

### 3. Verify Pipeline Setup

#### Test the Pipeline

1. Make a small change to the code:
   ```bash
   echo "# Test commit" >> README.md
   git add README.md
   git commit -m "test: Verify CI/CD pipeline"
   git push origin main
   ```

2. Go to **Actions** tab in GitHub
3. Watch the deployment workflow run
4. Verify successful deployment

#### Check Deployment Outputs

After successful deployment, the pipeline creates:
- **Deployment summary** in the Actions run
- **CDK outputs artifact** (downloadable for 30 days)
- **GraphQL API URL** in the summary

---

## Pipeline Workflows

### Deployment Workflow

```yaml
Trigger: Push to main/develop/feature branches
├── Determine Environment
│   └── Sets stage based on branch
├── Lint and Test
│   ├── ESLint
│   ├── Tests
│   └── TypeScript build
├── Deploy (if not PR)
│   ├── Install dependencies
│   ├── Configure AWS credentials
│   ├── Build application
│   ├── Deploy with CDK
│   └── Upload outputs
└── Notify
    └── Report status
```

### Branch → Environment Mapping

| Branch Pattern | Environment | Auto-Deploy |
|----------------|-------------|-------------|
| `main` | prod | ✅ Yes |
| `develop` | test | ✅ Yes |
| `feature/*` | dev | ✅ Yes |
| Pull Request | N/A | ❌ No (test only) |

---

### Destroy Workflow

**Workflow File**: `.github/workflows/destroy.yml`

**Purpose**: Manually destroy infrastructure for a specific environment

**How to Use**:
1. Go to **Actions** → **Destroy AWS Infrastructure**
2. Click **Run workflow**
3. Select environment (`dev`, `test`, or `prod`)
4. Type `DESTROY` to confirm
5. Click **Run workflow**

**Safety Features**:
- Requires manual trigger (no automatic destruction)
- Requires typing "DESTROY" for confirmation
- 10-second delay for production environments
- Requires environment approval (if configured)

---

## Environment Variables

### Default Environment Variables

```yaml
NODE_VERSION: '18'
AWS_REGION: 'us-east-1'
```

### Per-Deployment Variables

```yaml
STAGE: dev | test | prod    # Determined by branch
```

---

## Deployment Process

### What Happens on Commit

1. **Code Push** → GitHub receives commit
2. **Workflow Trigger** → GitHub Actions starts
3. **Environment Detection** → Determines stage from branch
4. **Quality Checks** → Runs linting and tests
5. **AWS Authentication** → Configures AWS credentials
6. **Build** → Compiles TypeScript
7. **CDK Deployment** → Deploys to AWS
8. **Outputs** → Saves deployment information
9. **Summary** → Reports status

### Deployment Timeline

Typical deployment times:
- **Lint and Test**: ~1-2 minutes
- **Deploy to dev**: ~3-4 minutes
- **Deploy to test**: ~3-4 minutes
- **Deploy to prod**: ~3-4 minutes
- **Total**: ~5-6 minutes

---

## Monitoring Deployments

### View Deployment Status

1. Go to **Actions** tab
2. Click on the latest workflow run
3. View real-time logs for each step
4. Check deployment summary at the bottom

### Download Deployment Outputs

1. Go to workflow run
2. Scroll to **Artifacts**
3. Download `cdk-outputs-{stage}`
4. Extract to view full CDK outputs

---

## Troubleshooting

### Issue: "AWS credentials not configured"

**Solution**: Verify GitHub Secrets
```bash
# Check that secrets are set:
# Settings → Secrets and variables → Actions
# Verify AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY exist
```

### Issue: "CDK bootstrap required"

**Solution**: Bootstrap the AWS environment
```bash
# Run once per AWS account/region
cd packages/infrastructure
npx cdk bootstrap aws://ACCOUNT-ID/us-east-1
```

### Issue: "Tests failing"

**Solution**: Run tests locally first
```bash
npm run test
npm run lint
npm run build
```

### Issue: "Deployment timeout"

**Solution**: Check CloudFormation in AWS Console
- Go to CloudFormation console
- Find stuck stacks
- Review events for errors

### Issue: "Permission denied"

**Solution**: Verify IAM permissions
```bash
# Test AWS credentials
aws sts get-caller-identity

# Check user policies
aws iam list-attached-user-policies --user-name github-actions-deployer
```

---

## Advanced Configuration

### Custom Deployment Stages

To add a new environment (e.g., `staging`):

1. Update `.github/workflows/deploy.yml`:
   ```yaml
   elif [[ "${{ github.ref }}" == "refs/heads/staging" ]]; then
     echo "stage=staging" >> $GITHUB_OUTPUT
     echo "should-deploy=true" >> $GITHUB_OUTPUT
   ```

2. Create `staging` environment in GitHub Settings

3. Push to `staging` branch to deploy

### Parallel Deployments

To deploy multiple environments simultaneously:

```yaml
strategy:
  matrix:
    stage: [dev, test]
```

### Scheduled Deployments

Add a schedule trigger:

```yaml
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
```

### Deployment Notifications

#### Slack Notifications

Add to workflow:

```yaml
- name: Notify Slack
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "Deployment to ${{ needs.determine-environment.outputs.stage }} completed!"
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

#### Email Notifications

Configure in **Settings** → **Notifications** → **Actions**

---

## Security Best Practices

### 1. Use Least Privilege IAM Permissions

Instead of `AdministratorAccess`, create a custom policy (see `AWS_ACCESS_SETUP.md`)

### 2. Enable MFA for Production Deployments

```yaml
environment:
  name: prod
  required_reviewers: true
```

### 3. Rotate AWS Credentials Regularly

```bash
# Every 90 days
aws iam create-access-key --user-name github-actions-deployer
# Update GitHub secrets with new keys
aws iam delete-access-key --user-name github-actions-deployer --access-key-id OLD_KEY
```

### 4. Use OIDC Instead of Long-Lived Credentials (Recommended)

Replace AWS credentials with OIDC:

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::ACCOUNT:role/GitHubActionsRole
    aws-region: us-east-1
```

See: [AWS OIDC Setup Guide](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)

### 5. Scan for Secrets

Add secret scanning:

```yaml
- name: Scan for secrets
  uses: trufflesecurity/trufflehog@main
```

---

## Cost Optimization

### GitHub Actions Minutes

- **Free tier**: 2,000 minutes/month for private repos
- **Typical deployment**: ~5 minutes
- **Max deployments/month**: ~400 on free tier

### AWS Costs

Pipeline adds no additional AWS costs beyond the deployed resources.

---

## Pipeline Metrics

### Success Rate

Track in **Insights** → **Actions**

### Deployment Frequency

Monitor in **Actions** tab (weekly/monthly view)

### Mean Time to Deploy

Average: ~5-6 minutes

### Rollback Time

Manual rollback via AWS Console or `destroy` workflow

---

## Next Steps

1. ✅ **Pipeline created** - Automated deployment configured
2. 🔐 **Add secrets** - Configure AWS credentials in GitHub
3. 🧪 **Test deployment** - Push a commit and watch it deploy
4. 📧 **Add notifications** - Configure Slack/email alerts
5. 🛡️ **Add security scanning** - Trufflehog, SAST tools
6. 📊 **Add performance tests** - Load testing on deployed API
7. 🔄 **Set up staging environment** - Add intermediate testing stage

---

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [AWS CDK Deployment Guide](https://docs.aws.amazon.com/cdk/latest/guide/deploying.html)
- [GitHub Actions Best Practices](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [AWS OIDC Setup](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)

---

**Last Updated**: December 13, 2025
**Status**: ✅ Active
**Maintainer**: Development Team
