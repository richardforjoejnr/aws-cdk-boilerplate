# Deployment Guide

## Prerequisites

Before deploying this project, ensure you have:

1. **AWS Account** - You need an AWS account with appropriate permissions
2. **AWS CLI** - Install and configure the AWS CLI
3. **Node.js** - Version 18 or higher
4. **AWS CDK** - Install globally: `npm install -g aws-cdk`

## AWS Account Setup

### 1. Configure AWS Credentials

You have several options for configuring AWS credentials:

#### Option A: AWS CLI Configuration (Recommended for Development)

```bash
# Configure your AWS credentials
aws configure

# You'll be prompted for:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region (e.g., us-east-1)
# - Default output format (json)
```

This creates credentials in `~/.aws/credentials` and config in `~/.aws/config`.

#### Option B: Environment Variables

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_DEFAULT_REGION="us-east-1"
```

#### Option C: AWS SSO (Recommended for Organizations)

```bash
aws configure sso

# Follow the prompts to set up SSO
# Then login:
aws sso login --profile your-profile-name

# Export the profile:
export AWS_PROFILE=your-profile-name
```

#### Option D: IAM Roles (For EC2/ECS/Lambda)

If running on AWS infrastructure, attach an IAM role with appropriate permissions.

### 2. Verify AWS Configuration

```bash
# Check your current AWS identity
aws sts get-caller-identity

# This should return your account ID, user ID, and ARN
```

### 3. Required IAM Permissions

Your AWS user/role needs permissions for:

- CloudFormation (full access for CDK)
- Lambda (create, update, delete functions)
- DynamoDB (create, update, delete tables)
- AppSync (create, update, delete APIs)
- Step Functions (create, update, delete state machines)
- IAM (create roles and policies)
- CloudWatch Logs (create log groups)
- S3 (for CDK asset storage)

**Recommended Policy**: `AdministratorAccess` for initial setup, or create a custom policy with the specific permissions above.

### 4. Bootstrap CDK (One-Time Setup)

Before deploying CDK applications for the first time in a region, you must bootstrap it:

```bash
# Bootstrap for default account/region
cdk bootstrap

# Bootstrap for specific account/region
cdk bootstrap aws://ACCOUNT-ID/REGION

# Bootstrap for multiple environments
cdk bootstrap aws://ACCOUNT-ID/us-east-1 aws://ACCOUNT-ID/eu-west-1
```

This creates an S3 bucket and other resources CDK needs for deployments.

## Authentication Options

### Development Environment

For local development, the recommended authentication methods are:

1. **AWS CLI Credentials** - Best for individual developers
2. **AWS SSO** - Best for organizations with centralized identity management
3. **Environment Variables** - Good for CI/CD pipelines

### Production Environment

For production deployments:

1. **IAM Roles** - Attach to CodeBuild projects, EC2 instances, etc.
2. **AWS SSO** - For human access with MFA
3. **Cross-Account Roles** - For multi-account deployments

## Multi-Account Strategy

For proper environment isolation, consider this structure:

- **Development Account** - For dev environment
- **Staging Account** - For test environment
- **Production Account** - For prod environment

To deploy across accounts:

```bash
# Assume a role in the target account
aws sts assume-role --role-arn arn:aws:iam::ACCOUNT-ID:role/ROLE-NAME --role-session-name deployment

# Use the temporary credentials
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...

# Deploy
STAGE=prod npm run deploy
```

## Deployment Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Deploy to Development

```bash
# Deploy to dev environment
npm run deploy:dev

# Or manually
STAGE=dev npm run deploy
```

### 4. Deploy to Test

```bash
npm run deploy:test
```

### 5. Deploy to Production

```bash
npm run deploy:prod
```

## Environment-Specific Configuration

Each environment (dev, test, prod) uses different:

- Stack names (prefixed with environment)
- Resource names
- Removal policies (DESTROY for dev, RETAIN for prod)
- Logging levels
- Auto-scaling settings
- Billing modes

## Verifying Deployment

After deployment, CDK outputs important information:

```bash
# View the outputs
aws cloudformation describe-stacks --stack-name STAGE-aws-boilerplate-appsync

# Test the GraphQL API
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"query":"query { hello(name: \"World\") }"}' \
  YOUR_GRAPHQL_URL

# Test the Lambda function
aws lambda invoke \
  --function-name STAGE-hello-world \
  --payload '{"name": "Test"}' \
  response.json

# Test the Step Functions
aws stepfunctions start-execution \
  --state-machine-arn YOUR_STATE_MACHINE_ARN \
  --input '{"name": "Test"}'
```

## Troubleshooting

### Issue: "Unable to locate credentials"

**Solution**: Configure AWS credentials using one of the methods above.

### Issue: "CDK needs to be bootstrapped"

**Solution**: Run `cdk bootstrap` in the target account/region.

### Issue: "Access Denied"

**Solution**: Ensure your IAM user/role has sufficient permissions.

### Issue: "Stack already exists"

**Solution**: The stack name might conflict. Change the `STAGE` environment variable.

## Cleanup

To remove all deployed resources:

```bash
# Destroy dev environment
STAGE=dev npm run destroy

# Destroy test environment
STAGE=test npm run destroy

# Destroy prod environment (be careful!)
STAGE=prod npm run destroy
```

**Warning**: This will delete all resources, including data in DynamoDB tables (unless RETAIN policy is set).

## CI/CD Pipeline Setup

### GitHub Connection

1. Go to AWS Console → CodePipeline → Settings → Connections
2. Create a new GitHub connection
3. Authorize AWS to access your GitHub account
4. Update the connection ARN in `packages/infrastructure/lib/pipeline-stack.ts`

### Deploy Pipeline

```bash
# Deploy the pipeline stack (only needed once in prod account)
STAGE=prod npm run deploy
```

The pipeline will automatically:
- Build and test on every push
- Deploy to dev on every commit to feature branches
- Deploy to test on commits to main (with approval)
- Deploy to prod on tagged releases (with approval)

## Best Practices

1. **Never commit AWS credentials** - Use environment variables or AWS CLI profiles
2. **Use different AWS accounts** for different environments
3. **Enable MFA** on your AWS account
4. **Use IAM roles** instead of access keys when possible
5. **Rotate credentials** regularly
6. **Use least privilege** - Grant only necessary permissions
7. **Enable CloudTrail** for audit logging
8. **Tag all resources** for cost tracking and organization
9. **Use AWS Organizations** for multi-account management
10. **Implement automated testing** before production deployments
