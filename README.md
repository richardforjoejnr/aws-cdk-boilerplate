# AWS Lambda & Step Functions Boilerplate

A production-ready TypeScript boilerplate for AWS Lambda and Step Functions with Infrastructure as Code using AWS CDK.

## Features

- **TypeScript** - Full type safety across infrastructure and application code
- **AWS CDK** - Infrastructure as Code with AWS Cloud Development Kit
- **Monorepo** - Organized with npm workspaces
- **Multi-Environment** - Support for dev, test, and prod environments
- **CI/CD Pipeline** - AWS CodePipeline for automated deployments
- **Lambda Functions** - ES Modules with optimized bundling
- **Step Functions** - State machine orchestration
- **ESM** - Pure ES Modules architecture

## Project Structure

```
.
├── packages/
│   ├── infrastructure/    # CDK infrastructure code
│   │   ├── bin/          # CDK app entry point
│   │   └── lib/          # CDK stacks and constructs
│   └── functions/        # Lambda functions
│       └── src/          # Function source code
├── ci/                   # CI/CD pipeline definitions
└── scripts/              # Build and deployment scripts
```

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- AWS CLI configured with appropriate credentials
- AWS CDK CLI: `npm install -g aws-cdk`

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Bootstrap CDK (First Time Only)

```bash
cd packages/infrastructure
npx cdk bootstrap
```

### 3. Deploy to Development

```bash
npm run deploy:dev
```

## Available Scripts

- `npm run build` - Build all packages
- `npm run test` - Run tests across all packages
- `npm run lint` - Lint TypeScript files
- `npm run format` - Format code with Prettier
- `npm run deploy:dev` - Deploy to development environment
- `npm run deploy:test` - Deploy to test environment
- `npm run deploy:prod` - Deploy to production environment
- `npm run destroy` - Destroy the current stack

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

The pipeline automatically:

1. Builds and tests code on every push
2. Deploys to environments based on branch:
   - Feature branches → dev environment
   - `main` branch → test environment
   - Tagged releases → prod environment

## Infrastructure as Code

All infrastructure is defined using AWS CDK in TypeScript:

- **Pipeline Stack** - CodePipeline for CI/CD
- **Lambda Stack** - Lambda functions and related resources
- **Step Functions Stack** - State machines and workflows

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

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting: `npm run test && npm run lint`
4. Commit with descriptive messages
5. Push and create a pull request

## License

MIT
