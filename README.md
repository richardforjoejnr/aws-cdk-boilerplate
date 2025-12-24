# AWS Lambda & Step Functions Boilerplate

A production-ready TypeScript boilerplate for AWS Lambda and Step Functions with Infrastructure as Code using AWS CDK.

## 🚀 Quick Start

**First time here?** Start with these guides:

1. **[QUICK_START.md](./QUICK_START.md)** - Get deployed in 5 minutes
2. **[AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md)** - Configure AWS credentials and IAM permissions
3. **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Comprehensive deployment guide

### TL;DR

```bash
# 1. Configure AWS credentials
aws configure

# 2. Install dependencies
npm install

# 3. Bootstrap CDK (one-time)
cd packages/infrastructure && npx cdk bootstrap && cd ../..

# 4. Deploy
npm run deploy:dev
```

## Features

- **TypeScript** - Full type safety across infrastructure and application code
- **AWS CDK** - Infrastructure as Code with AWS Cloud Development Kit
- **AppSync** - GraphQL API with DynamoDB and Lambda resolvers
- **DynamoDB** - NoSQL database with streams and GSIs
- **React Web App** - Amplify-powered frontend with CRUD operations
- **Monorepo** - Organized with npm workspaces
- **Multi-Environment** - Support for dev, test, and prod environments
- **CI/CD Pipeline** - GitHub Actions for automated deployments
- **Lambda Functions** - ES Modules with optimized bundling
- **Step Functions** - State machine orchestration
- **ESM** - Pure ES Modules architecture
- **Testing** - Comprehensive test suite with Jest

## Project Structure

```
.
├── packages/
│   ├── infrastructure/    # CDK infrastructure code
│   │   ├── bin/          # CDK app entry point
│   │   └── lib/          # CDK stacks and constructs
│   ├── functions/        # Lambda functions
│   │   └── src/          # Function source code
│   └── web-app/          # React frontend application
│       └── src/          # React components and logic
├── ci/                   # CI/CD pipeline definitions
└── scripts/              # Build and deployment scripts
```

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- **AWS Account** with credentials configured
- AWS CLI installed
- AWS CDK CLI (optional): `npm install -g aws-cdk`

## AWS Access Setup

**Need help configuring AWS access?** See [AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md)

### Quick AWS Setup

```bash
# Run the automated setup checker
./scripts/setup-aws-access.sh

# Or manually configure
aws configure
```

You'll need:
- **AWS Access Key ID** (create in IAM console)
- **AWS Secret Access Key**
- **Default region** (e.g., us-east-1)

See [AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md) for:
- How to create IAM users
- Required IAM permissions (custom policy included)
- Multi-account setup
- SSO configuration
- Troubleshooting

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Bootstrap CDK (First Time Only)

```bash
cd packages/infrastructure
npx cdk bootstrap
cd ../..
```

### 3. Deploy to Development

```bash
npm run deploy:dev
```

### 4. Test Your Deployment

After deployment, test the Lambda function:

```bash
aws lambda invoke \
  --function-name dev-hello-world \
  --payload '{"name": "World"}' \
  response.json && cat response.json
```

### 5. Run the Web Application (Optional)

The boilerplate includes a React web application that demonstrates CRUD operations with the deployed AppSync API.

**Option A: Run Locally**

```bash
# Configure the web app with your deployed environment
npm run webapp:config:dev

# Start the development server
npm run webapp:dev
```

The web app will be available at `http://localhost:3000`.

**Option B: Deploy to AWS (S3 + CloudFront)**

```bash
# Deploy web app to AWS
npm run deploy:webapp:dev
```

This will:
1. Configure the web app with your AppSync API
2. Build the React app
3. Deploy to S3 with CloudFront CDN
4. Output the public URL

The web app features:
- Create new items in DynamoDB
- View all items in a table
- Delete items with confirmation

See **[packages/web-app/README.md](./packages/web-app/README.md)** for more details.

## Available Scripts

### 🚀 Smart Deployment (Recommended)

**NEW:** These commands automatically handle orphaned resources and failed stacks!

- `npm run deploy:dev` - Deploy to dev with automatic cleanup ✨
- `npm run deploy:test` - Deploy to test with automatic cleanup ✨
- `npm run deploy:prod` - Deploy to prod with automatic cleanup ✨
- `npm run deploy:dev:webapp` - Deploy dev with web app included ✨
- `npm run deploy:test:webapp` - Deploy test with web app included ✨
- `npm run deploy:prod:webapp` - Deploy prod with web app included ✨

**What the smart deployment does:**
1. ✅ Validates AWS credentials
2. ✅ Cleans up orphaned resources (DynamoDB tables, CloudWatch logs)
3. ✅ Removes failed CloudFormation stacks
4. ✅ Builds all packages
5. ✅ Deploys infrastructure
6. ✅ Generates deployment summary with all endpoints
7. ✅ Saves outputs to `.deployment-outputs-{stage}.json`

### Infrastructure
- `npm run build` - Build all packages
- `npm run test` - Run tests across all packages
- `npm run lint` - Lint TypeScript files
- `npm run format` - Format code with Prettier
- `npm run destroy:dev` - Destroy dev environment (all stacks)
- `npm run destroy:test` - Destroy test environment (all stacks)
- `npm run destroy:prod` - Destroy prod environment (all stacks)

### Web Application
- `npm run webapp:dev` - Run web app development server
- `npm run webapp:config:dev` - Configure web app with dev environment
- `npm run webapp:config:test` - Configure web app with test environment
- `npm run webapp:config:prod` - Configure web app with prod environment
- `npm run deploy:webapp:dev` - Deploy only web app to dev (S3 + CloudFront)
- `npm run deploy:webapp:test` - Deploy only web app to test (S3 + CloudFront)
- `npm run deploy:webapp:prod` - Deploy only web app to prod (S3 + CloudFront)

### 🧹 Cleanup & Validation
- `npm run cleanup:orphaned:dev` - Clean up orphaned resources (DynamoDB, logs)
- `npm run cleanup:orphaned:test` - Clean up orphaned resources
- `npm run cleanup:orphaned:prod` - Clean up orphaned resources
- `npm run cleanup:failed:dev` - Remove failed CloudFormation stacks
- `npm run cleanup:failed:test` - Remove failed CloudFormation stacks
- `npm run cleanup:failed:prod` - Remove failed CloudFormation stacks
- `npm run validate:dev` - Validate deployment health
- `npm run validate:test` - Validate deployment health
- `npm run validate:prod` - Validate deployment health

See **[scripts/README.md](./scripts/README.md)** for detailed documentation on all deployment scripts.

## Environments

The project supports three environments:

- **dev** - Development environment for individual developers
- **test** - Testing/staging environment
- **prod** - Production environment

Environment configuration is managed through the `STAGE` environment variable and CDK context.

## Lambda Functions

Lambda functions are located in `packages/functions/src/`. Each function:

- Uses TypeScript with ES Modules
- Is bundled with esbuild for optimal performance
- Includes CloudWatch Logs with retention policies
- Has environment-specific configuration

### Adding a New Function

1. Create a new directory in `packages/functions/src/`
2. Add your handler code
3. Reference it in the Lambda stack (`packages/infrastructure/lib/lambda-stack.ts`)

## Step Functions

State machines are defined in `packages/infrastructure/lib/step-functions-stack.ts`. The boilerplate includes an example workflow that:

- Invokes Lambda functions
- Handles errors and retries
- Integrates with other AWS services

## CI/CD Pipeline

Automated deployment using GitHub Actions:

### Branch → Environment Mapping
- `feature/*` branches → **dev** environment
- `develop` branch → **test** environment
- `main` branch → **prod** environment
- Pull requests → **test only** (no deployment)

### Workflows

**1. Infrastructure Deployment (`.github/workflows/deploy.yml`)**
- Triggered on push to main/develop/feature branches
- Deploys: Database, Lambda, AppSync, Step Functions
- Automatic on every commit

**2. Web App Deployment (`.github/workflows/deploy-webapp.yml`)**
- Triggered on:
  - Manual workflow dispatch (choose environment)
  - Push to main/develop/feature with changes to `packages/web-app/**`
- Deploys: S3 bucket + CloudFront distribution with built React app
- Outputs public URL

### Pipeline Features
1. **Automatic deployment** on every push
2. **Quality gates**: Linting, testing, and type checking
3. **Environment protection**: Manual approval for production
4. **Deployment artifacts**: CDK outputs saved for 30 days
5. **Rollback support**: Manual destroy workflow
6. **Separate web app pipeline**: Deploy frontend independently

See **[CI_CD_SETUP.md](./CI_CD_SETUP.md)** for complete setup instructions.

## Infrastructure as Code

All infrastructure is defined using AWS CDK in TypeScript:

- **Database Stack** - DynamoDB tables with streams and GSIs
- **Lambda Stack** - Lambda functions and related resources
- **AppSync Stack** - GraphQL API with multiple data sources
- **Step Functions Stack** - State machines and workflows
- **Web App Stack** (Optional) - S3 bucket + CloudFront distribution for React app

### Deploying Changes

```bash
# Deploy to specific environment
STAGE=dev npm run deploy

# Or use the convenience scripts
npm run deploy:dev
npm run deploy:test
npm run deploy:prod
```

## Security

- Least privilege IAM roles
- Environment variable management
- Secrets stored in AWS Secrets Manager
- CloudWatch logging for audit trails

## What Gets Deployed

This boilerplate deploys:

### DynamoDB
- Main table with partition key (pk) and sort key (sk)
- 2 Global Secondary Indexes (GSI1, GSI2)
- DynamoDB Streams enabled
- Auto-scaling in production

### Lambda Functions
- `hello-world` - Simple greeting function
- `dynamodb-stream-handler` - Processes DynamoDB stream events
- Node.js 18 runtime with ES Modules
- CloudWatch Logs with retention

### AppSync GraphQL API
- API Key and IAM authorization
- CRUD operations: createItem, getItem, updateItem, deleteItem, listItems
- Lambda resolver for custom queries
- X-Ray tracing (production)

### Step Functions
- State machine with Lambda integration
- Error handling and retries
- CloudWatch Logs

### Web App (Optional)
- React 18 application with TypeScript
- S3 bucket for static hosting
- CloudFront distribution for global CDN
- Automatic invalidation on deployment
- HTTPS enabled
- AWS Amplify for GraphQL integration

### CI/CD Pipeline (GitHub Actions)
- Automated deployment on push to main/develop/feature branches
- Branch-based environment deployment (main→prod, develop→test, feature/*→dev)
- Quality gates: linting, testing, and type checking
- Separate web app deployment workflow
- Manual destroy workflow with safety confirmations

## Cleanup & Destroy

To completely remove all AWS resources for an environment:

```bash
# Destroy dev environment
npm run destroy:dev

# Destroy test environment
npm run destroy:test

# Destroy prod environment
npm run destroy:prod
```

This will delete **all stacks** in the specified environment:
- `{stage}-aws-boilerplate-database` - DynamoDB tables
- `{stage}-aws-boilerplate-lambda` - Lambda functions
- `{stage}-aws-boilerplate-appsync` - GraphQL API
- `{stage}-aws-boilerplate-step-functions` - State machines
- `{stage}-aws-boilerplate-web-app` - S3 bucket and CloudFront (automatically included if exists)

**Note:** Production resources have deletion protection enabled. You may need to manually disable protection for DynamoDB tables before destroying.

**If you encounter orphaned resources:**
```bash
npm run cleanup:dev    # Clean up failed dev stacks
npm run cleanup:test   # Clean up failed test stacks
npm run cleanup:prod   # Clean up failed prod stacks
```

See **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** for detailed cleanup procedures.

## Documentation

- **[QUICK_START.md](./QUICK_START.md)** - 5-minute setup guide
- **[AWS_ACCESS_SETUP.md](./AWS_ACCESS_SETUP.md)** - AWS credentials and IAM setup
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Comprehensive deployment guide
- **[CI_CD_SETUP.md](./CI_CD_SETUP.md)** - GitHub Actions pipeline configuration
- **[DEPLOYMENT_SUCCESS.md](./DEPLOYMENT_SUCCESS.md)** - Latest deployment documentation
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and solutions

## Cost Estimate

Development environment with light usage:
- DynamoDB: Pay-per-request (~$0)
- Lambda: Free tier (1M requests/month)
- AppSync: Free tier (250K queries/month)
- Step Functions: Free tier (4K transitions/month)

**Estimated: < $1/month for testing**

## Cleanup

```bash
# Remove all resources
STAGE=dev npm run destroy
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting: `npm run test && npm run lint`
4. Commit with descriptive messages
5. Push and create a pull request

## License

MIT
