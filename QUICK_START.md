# Quick Start Guide

## TL;DR - Get Started in 5 Minutes

### Prerequisites
- Node.js 18+
- AWS Account
- AWS CLI installed

### 1. Configure AWS Access (First Time)

```bash
# Configure your AWS credentials
aws configure

# You'll need:
# - AWS Access Key ID (from IAM console)
# - AWS Secret Access Key (from IAM console)
# - Default region (e.g., us-east-1)
```

**Don't have AWS credentials yet?**
1. Go to [AWS Console → IAM → Users](https://console.aws.amazon.com/iam/home#/users)
2. Click "Add user"
3. Username: `cdk-deployer`
4. Enable "Access key - Programmatic access"
5. Attach policy: `AdministratorAccess` (for learning)
6. Copy the Access Key ID and Secret Access Key
7. Run `aws configure` and paste them

### 2. Verify Setup

```bash
# Run the automated setup checker
./scripts/setup-aws-access.sh

# Or manually verify
aws sts get-caller-identity
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Bootstrap CDK (One-Time)

```bash
cd packages/infrastructure
npx cdk bootstrap
cd ../..
```

### 5. Deploy

```bash
# Deploy to development environment
npm run deploy:dev
```

### 6. Test Your Deployment

After deployment completes, CDK will output:

```
Outputs:
dev-aws-boilerplate-appsync.GraphQLApiUrl = https://xxxxx.appsync-api.us-east-1.amazonaws.com/graphql
dev-aws-boilerplate-appsync.GraphQLApiKey = da2-xxxxxxxxxxxx
dev-aws-boilerplate-lambda.HelloWorldFunctionName = dev-hello-world
```

#### Test the Lambda Function

```bash
aws lambda invoke \
  --function-name dev-hello-world \
  --payload '{"name": "World"}' \
  response.json && cat response.json
```

#### Test the GraphQL API

```bash
# Set your API details from the outputs
API_URL="<your-graphql-url>"
API_KEY="<your-api-key>"

# Query: Hello World
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"query":"query { hello(name: \"CDK\") }"}' \
  $API_URL

# Mutation: Create an item
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"query":"mutation { createItem(input: {name: \"Test Item\", description: \"My first item\"}) { pk name description createdAt } }"}' \
  $API_URL

# Query: List items
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"query":"query { listItems { pk name description createdAt } }"}' \
  $API_URL
```

#### Test the Step Functions

```bash
# Get the state machine ARN from outputs
STATE_MACHINE_ARN="<your-state-machine-arn>"

# Start execution
aws stepfunctions start-execution \
  --state-machine-arn $STATE_MACHINE_ARN \
  --input '{"name": "Step Functions Test"}'

# Check execution status
aws stepfunctions list-executions \
  --state-machine-arn $STATE_MACHINE_ARN \
  --max-results 1
```

## Project Structure

```
aws-cdk-boilerplate/
├── packages/
│   ├── infrastructure/          # CDK Infrastructure
│   │   ├── bin/app.ts          # CDK app entry point
│   │   ├── lib/
│   │   │   ├── database-stack.ts      # DynamoDB
│   │   │   ├── lambda-stack.ts        # Lambda functions
│   │   │   ├── appsync-stack.ts       # GraphQL API
│   │   │   ├── step-functions-stack.ts # State machines
│   │   │   └── pipeline-stack.ts      # CI/CD
│   │   └── schema/
│   │       └── schema.graphql   # GraphQL schema
│   └── functions/               # Lambda function code
│       └── src/
│           ├── hello-world/
│           └── dynamodb-stream-handler/
└── ci/
    └── buildspec.yml            # CodeBuild configuration
```

## Available Commands

```bash
# Development
npm run build              # Build all packages
npm run test               # Run tests
npm run lint               # Lint code
npm run format             # Format code with Prettier

# Deployment
npm run deploy:dev         # Deploy to dev environment
npm run deploy:test        # Deploy to test environment
npm run deploy:prod        # Deploy to prod environment

# CDK Commands
cd packages/infrastructure
npx cdk diff               # Show what will change
npx cdk synth              # Synthesize CloudFormation
npx cdk deploy --all       # Deploy all stacks
npx cdk destroy --all      # Delete all stacks

# View deployed resources
npx cdk list               # List all stacks
```

## Environment Variables

The `STAGE` environment variable controls which environment to deploy to:

- `dev` - Development (default)
- `test` - Testing/Staging
- `prod` - Production

Different environments have different configurations:
- **Dev**: Pay-per-request DynamoDB, DESTROY removal policy, verbose logging
- **Test**: Provisioned DynamoDB, RETAIN removal policy, error logging only
- **Prod**: Provisioned DynamoDB with auto-scaling, RETAIN policy, minimal logging

## What Gets Deployed

### DynamoDB Table
- Table name: `{stage}-main-table`
- Partition key: `pk` (String)
- Sort key: `sk` (String)
- 2 Global Secondary Indexes (GSI1, GSI2)
- DynamoDB Streams enabled

### Lambda Functions
- `{stage}-hello-world` - Simple greeting function
- Runtime: Node.js 18
- Architecture: ES Modules
- CloudWatch Logs with retention

### AppSync GraphQL API
- API name: `{stage}-api`
- Authorization: API Key + IAM
- Data sources: DynamoDB + Lambda
- Operations:
  - Queries: `getItem`, `listItems`, `hello`
  - Mutations: `createItem`, `updateItem`, `deleteItem`

### Step Functions
- State machine: `{stage}-hello-world-state-machine`
- Orchestrates Lambda invocation
- Error handling and retries
- CloudWatch Logs enabled

### CI/CD Pipeline (prod only)
- Source: GitHub
- Build: CodeBuild
- Stages: Dev → Test (approval) → Prod (approval)

## Cost Estimate

With default settings in **dev environment**:
- DynamoDB: Pay-per-request (~$0 for testing)
- Lambda: Free tier covers 1M requests/month
- AppSync: Free tier covers 250K queries/month
- Step Functions: Free tier covers 4K state transitions/month
- CloudWatch Logs: Minimal cost for retention

**Estimated cost for light testing: < $1/month**

## Common Issues

### Issue: "Unable to locate credentials"
```bash
# Run this to configure
aws configure
```

### Issue: "CDK bootstrap required"
```bash
cd packages/infrastructure
npx cdk bootstrap
```

### Issue: "Access Denied"
```bash
# Check your IAM permissions
aws sts get-caller-identity

# You need CloudFormation, Lambda, DynamoDB, AppSync, IAM permissions
# See AWS_ACCESS_SETUP.md for detailed IAM policy
```

### Issue: "Stack already exists"
```bash
# Use a different stage name
STAGE=myname npm run deploy
```

## Cleanup

To remove all resources and avoid charges:

```bash
# Destroy dev environment
STAGE=dev npm run destroy

# Or manually
cd packages/infrastructure
STAGE=dev npx cdk destroy --all
```

**Warning**: This deletes all data. Production stacks have RETAIN policies to prevent accidental deletion.

## Next Steps

1. ✅ Deploy the boilerplate
2. 📖 Read [AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md) for IAM configuration
3. 📖 Read [DEPLOYMENT.md](./DEPLOYMENT.md) for multi-environment setup
4. 🔧 Modify Lambda functions in `packages/functions/src/`
5. 🗄️ Update GraphQL schema in `packages/infrastructure/schema/schema.graphql`
6. 🚀 Set up CI/CD pipeline for automated deployments

## Learn More

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [AWS AppSync Documentation](https://docs.aws.amazon.com/appsync/)
- [AWS Step Functions Documentation](https://docs.aws.amazon.com/step-functions/)
- [DynamoDB Documentation](https://docs.aws.amazon.com/dynamodb/)

## Getting Help

- Check [AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md) for authentication issues
- Check [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment guides
- GitHub Issues: [Report a problem](https://github.com/richardforjoejnr/aws-cdk-boilerplate/issues)
