# AWS Access Setup Guide

## Overview

For this repository to deploy infrastructure to your AWS account, you need:

1. **AWS Credentials** - Authentication to prove who you are
2. **IAM Permissions** - Authorization for what actions you can perform
3. **CDK Bootstrap** - One-time setup for CDK deployments

## 1. Local Development Access

### Step 1: Create an IAM User (Recommended for Learning)

1. Go to AWS Console → IAM → Users → Add User
2. User name: `cdk-deployer` (or your preference)
3. Enable **Access key - Programmatic access**
4. Click **Next: Permissions**

### Step 2: Attach Permissions

**Option A: Quick Start (AdministratorAccess)**
- Attach policy: `AdministratorAccess`
- ⚠️ Warning: This gives full access. Good for learning, but not for production.

**Option B: Least Privilege (Recommended for Production)**
- Create a custom policy (see IAM Policy section below)

### Step 3: Save Your Credentials

After creating the user, you'll see:
- **Access Key ID**: `AKIAIOSFODNN7EXAMPLE`
- **Secret Access Key**: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`

⚠️ **IMPORTANT**: Save these credentials securely. The secret key is only shown once!

### Step 4: Configure AWS CLI

```bash
# Install AWS CLI if you haven't
# macOS
brew install awscli

# Or download from: https://aws.amazon.com/cli/

# Configure credentials
aws configure

# Enter your credentials:
AWS Access Key ID: <paste your access key>
AWS Secret Access Key: <paste your secret key>
Default region name: us-east-1
Default output format: json
```

### Step 5: Verify Access

```bash
# Check your identity
aws sts get-caller-identity

# Should return something like:
# {
#     "UserId": "AIDAI...",
#     "Account": "123456789012",
#     "Arn": "arn:aws:iam::123456789012:user/cdk-deployer"
# }
```

## 2. Required IAM Permissions

### Minimum IAM Policy for CDK Deployment

Create a custom policy with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationAccess",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": [
        "s3:*"
      ],
      "Resource": [
        "arn:aws:s3:::cdk-*",
        "arn:aws:s3:::cdk-*/*"
      ]
    },
    {
      "Sid": "IAMAccess",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LambdaAccess",
      "Effect": "Allow",
      "Action": [
        "lambda:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AppSyncAccess",
      "Effect": "Allow",
      "Action": [
        "appsync:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "StepFunctionsAccess",
      "Effect": "Allow",
      "Action": [
        "states:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LogsAccess",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:DeleteLogGroup",
        "logs:PutRetentionPolicy",
        "logs:DeleteRetentionPolicy",
        "logs:TagLogGroup",
        "logs:UntagLogGroup"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SSMAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:PutParameter",
        "ssm:DeleteParameter",
        "ssm:AddTagsToResource",
        "ssm:RemoveTagsFromResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECRAccess",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:CreateRepository",
        "ecr:DeleteRepository"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CodePipelineAccess",
      "Effect": "Allow",
      "Action": [
        "codepipeline:*",
        "codebuild:*",
        "codecommit:*",
        "codestar-connections:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EventsAccess",
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets"
      ],
      "Resource": "*"
    }
  ]
}
```

### How to Create This Policy

1. AWS Console → IAM → Policies → Create Policy
2. Click **JSON** tab
3. Paste the policy above
4. Click **Next: Tags** (optional)
5. Click **Next: Review**
6. Name: `CDK-Deployment-Policy`
7. Click **Create Policy**
8. Go back to your IAM user and attach this policy

## 3. CDK Bootstrap

Before you can deploy CDK apps, you must bootstrap your AWS environment:

```bash
# Bootstrap default account/region
cdk bootstrap

# Or specify account and region explicitly
cdk bootstrap aws://YOUR-ACCOUNT-ID/us-east-1

# What this does:
# - Creates S3 bucket for CDK assets (cdk-hnb659fds-assets-ACCOUNT-REGION)
# - Creates IAM roles for deployments
# - Sets up ECR repository for Docker images (if needed)
# - Creates SSM parameters for version tracking
```

You only need to bootstrap once per account/region combination.

## 4. Alternative: Using AWS SSO (Recommended for Organizations)

If your organization uses AWS SSO:

```bash
# Configure SSO
aws configure sso

# Follow prompts:
# SSO start URL: https://your-org.awsapps.com/start
# SSO Region: us-east-1
# SSO Account: (select your account)
# SSO Role: (select a role with sufficient permissions)
# CLI default region: us-east-1
# CLI output format: json

# Login
aws sso login --profile your-profile-name

# Use the profile
export AWS_PROFILE=your-profile-name

# Or set it in your shell config
echo 'export AWS_PROFILE=your-profile-name' >> ~/.zshrc
```

## 5. CI/CD Pipeline Access (For Automated Deployments)

If you want to set up the CI/CD pipeline, you need:

### GitHub Connection

1. Go to AWS Console → CodePipeline → Settings → Connections
2. Click **Create Connection**
3. Select **GitHub**
4. Name: `github-connection`
5. Click **Connect to GitHub**
6. Authorize AWS
7. Copy the Connection ARN

### Update Pipeline Stack

Edit `packages/infrastructure/lib/pipeline-stack.ts`:

```typescript
const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
  actionName: 'GitHub_Source',
  owner: 'richardforjoejnr',  // Your GitHub username
  repo: 'aws-cdk-boilerplate',
  branch: 'main',
  connectionArn: 'arn:aws:codestar-connections:us-east-1:ACCOUNT:connection/xxxxx', // Your connection ARN
  output: sourceOutput,
});
```

### CodeBuild Service Role

When you deploy the pipeline stack, CDK will automatically create IAM roles for CodeBuild with appropriate permissions. You don't need to create these manually.

## 6. Multi-Account Setup (Optional)

For proper isolation between environments:

### Account Structure
- **Dev Account** (123456789012) - For development
- **Test Account** (234567890123) - For staging/testing
- **Prod Account** (345678901234) - For production

### Cross-Account Deployment

1. **In Target Account**: Create a deployment role

```bash
# In target account, create trust relationship
aws iam create-role --role-name CDKDeploymentRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::SOURCE-ACCOUNT-ID:root"
      },
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach permissions
aws iam attach-role-policy \
  --role-name CDKDeploymentRole \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

2. **In Source Account**: Assume the role

```bash
# Assume role in target account
aws sts assume-role \
  --role-arn arn:aws:iam::TARGET-ACCOUNT:role/CDKDeploymentRole \
  --role-session-name deployment-session

# Export the temporary credentials
export AWS_ACCESS_KEY_ID=ASIAI...
export AWS_SECRET_ACCESS_KEY=xxxxx
export AWS_SESSION_TOKEN=xxxxx

# Deploy
STAGE=test npm run deploy
```

## 7. Environment Variables Method

Alternative to AWS CLI configuration:

```bash
# Set in your terminal or CI/CD
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_DEFAULT_REGION="us-east-1"

# Deploy
npm run deploy:dev
```

**For CI/CD**, set these as secrets in GitHub:
- Repository → Settings → Secrets and Variables → Actions
- Add: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

## 8. Security Best Practices

1. **Never commit credentials to Git**
   - Already in `.gitignore`: `.env`, `.aws/`, etc.

2. **Use IAM roles when possible**
   - EC2: Attach IAM role to instance
   - Lambda: Execution role (CDK creates automatically)
   - ECS: Task role

3. **Enable MFA** on your AWS account
   - Console → IAM → Users → Security credentials → MFA

4. **Rotate credentials regularly**
   - Create new access keys every 90 days
   - Delete old ones

5. **Use least privilege**
   - Start with minimal permissions
   - Add more as needed
   - Use the custom policy above instead of `AdministratorAccess` in production

6. **Monitor usage**
   - Enable CloudTrail for audit logs
   - Set up AWS Budgets for cost alerts

## 9. Quick Start Checklist

- [ ] Create IAM user or configure SSO
- [ ] Attach `AdministratorAccess` or custom policy
- [ ] Run `aws configure` with credentials
- [ ] Verify with `aws sts get-caller-identity`
- [ ] Run `cdk bootstrap` in your account
- [ ] Install dependencies: `npm install`
- [ ] Deploy: `npm run deploy:dev`

## 10. Troubleshooting

### Error: "Unable to locate credentials"
**Solution**: Run `aws configure` or set environment variables

### Error: "User is not authorized to perform: cloudformation:CreateStack"
**Solution**: Attach proper IAM permissions (see policy above)

### Error: "CDK bootstrap stack not found"
**Solution**: Run `cdk bootstrap`

### Error: "Access Denied" on S3 bucket
**Solution**: Ensure your user has S3 permissions for `cdk-*` buckets

### Error: "Cannot assume role"
**Solution**: Check trust relationship in target account's role

## Next Steps

Once you have credentials configured:

```bash
# 1. Install dependencies
npm install

# 2. Bootstrap CDK
cd packages/infrastructure
npx cdk bootstrap

# 3. Deploy to dev
npm run deploy:dev
```

Your CDK deployment will output all the resource ARNs and endpoints you need!
