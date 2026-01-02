# Technology Stack & AWS Services

This document provides a comprehensive overview of the technology stack and AWS services used in this AWS boilerplate project.

---

## Table of Contents

- [Frontend Stack](#frontend-stack)
- [Backend Stack](#backend-stack)
- [Infrastructure as Code](#infrastructure-as-code)
- [AWS Services](#aws-services)
- [Development Tools](#development-tools)
- [CI/CD Pipeline](#cicd-pipeline)

---

## Frontend Stack

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **HTML5** | Latest | Static web pages and structure |
| **CSS3** | Latest | Styling and responsive design |
| **JavaScript (ES6+)** | Latest | Client-side interactivity |
| **Chart.js** | 4.x | Data visualization (Jira Dashboard charts) |

### Frontend Applications

#### 1. Main Web Application
- **Location:** `packages/web-app/src/index.html`
- **Purpose:** Main landing page and demo application
- **Features:**
  - GraphQL API integration
  - Real-time data fetching
  - Responsive design

#### 2. Jira Dashboard
- **Location:** `packages/web-app/src/jira-dashboard/`
- **Purpose:** Comprehensive Jira analytics and visualization
- **Key Features:**
  - CSV upload and processing
  - Real-time metrics dashboard
  - Historical trend analysis
  - Interactive charts (status, priority, type distributions)
  - Project-based filtering
  - Cost tracking (AWS spend visualization)

---

## Backend Stack

### Runtime & Language

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 20.x | Runtime environment |
| **TypeScript** | 5.x | Type-safe development |
| **ESM (ES Modules)** | Latest | Modern module system |

### Backend Functions

#### Lambda Functions

1. **Hello World Function**
   - **Location:** `packages/functions/src/hello-world/`
   - **Purpose:** Demo Lambda with DynamoDB integration
   - **Runtime:** Node.js 20.x

2. **Jira CSV Processor**
   - **Location:** `packages/functions/src/jira-csv-processor/`
   - **Purpose:** Initial CSV upload handling
   - **Memory:** 3008 MB
   - **Timeout:** 15 minutes

3. **Jira Process Batch**
   - **Location:** `packages/functions/src/jira-process-batch/`
   - **Purpose:** Batch processing of CSV rows via Step Functions
   - **Memory:** 3008 MB
   - **Timeout:** 15 minutes
   - **Batch Size:** 500 rows per iteration

4. **Jira Start Processing**
   - **Location:** `packages/functions/src/jira-start-processing/`
   - **Purpose:** S3 trigger to initiate Step Functions workflow
   - **Timeout:** 30 seconds

5. **Jira Finalize Upload**
   - **Location:** `packages/functions/src/jira-finalize-upload/`
   - **Purpose:** Completion of CSV processing workflow
   - **Memory:** 1024 MB
   - **Timeout:** 5 minutes

6. **Get Upload URL**
   - **Location:** `packages/functions/src/jira-get-upload-url/`
   - **Purpose:** Generate presigned S3 upload URLs
   - **Timeout:** 30 seconds

7. **Get Dashboard Data**
   - **Location:** `packages/functions/src/jira-get-dashboard-data/`
   - **Purpose:** Fetch aggregated dashboard metrics
   - **Memory:** 1024 MB

8. **Get Historical Data**
   - **Location:** `packages/functions/src/jira-get-historical-data/`
   - **Purpose:** Retrieve historical trend data

9. **List Uploads**
   - **Location:** `packages/functions/src/jira-list-uploads/`
   - **Purpose:** List all CSV uploads

10. **Delete Upload**
    - **Location:** `packages/functions/src/jira-delete-upload/`
    - **Purpose:** Delete upload and associated data
    - **Timeout:** 60 seconds

11. **Get Upload Status**
    - **Location:** `packages/functions/src/jira-get-upload-status/`
    - **Purpose:** Check processing status

12. **Get AWS Costs**
    - **Location:** `packages/functions/src/get-costs/`
    - **Purpose:** Fetch AWS Cost Explorer data
    - **Permissions:** `ce:GetCostAndUsage`

### GraphQL API

- **Type:** AWS AppSync
- **Schema:** `packages/infrastructure/lib/graphql/schema.graphql`
- **Resolvers:** VTL (Velocity Template Language)
- **Data Sources:** DynamoDB tables

---

## Infrastructure as Code

### AWS CDK

| Technology | Version | Purpose |
|------------|---------|---------|
| **AWS CDK** | 2.x | Infrastructure definition |
| **TypeScript** | 5.x | CDK code language |
| **Node.js** | 20.x | CDK runtime |

### CDK Stacks

#### 1. Database Stack
- **File:** `packages/infrastructure/lib/database-stack.ts`
- **Resources:**
  - Main DynamoDB table with GSIs
  - Point-in-time recovery (prod)
  - Auto-scaling (prod)
  - DynamoDB Streams

#### 2. Lambda Stack
- **File:** `packages/infrastructure/lib/lambda-stack.ts`
- **Resources:**
  - Hello World Lambda function
  - IAM roles and policies
  - CloudWatch Logs

#### 3. AppSync Stack
- **File:** `packages/infrastructure/lib/appsync-stack.ts`
- **Resources:**
  - GraphQL API
  - DynamoDB resolvers
  - API authentication

#### 4. Step Functions Stack
- **File:** `packages/infrastructure/lib/step-functions-stack.ts`
- **Resources:**
  - State machine for Hello World workflow
  - Lambda integrations
  - IAM execution role

#### 5. Jira Dashboard Stack
- **File:** `packages/infrastructure/lib/jira-dashboard-stack.ts`
- **Resources:**
  - All Jira Lambda functions
  - Step Functions for CSV processing
  - API Gateway REST API
  - DynamoDB tables (uploads, issues)
  - S3 bucket for CSV storage
  - S3 event notifications

#### 6. Web App Stack
- **File:** `packages/infrastructure/lib/web-app-stack.ts`
- **Resources:**
  - S3 bucket for static hosting
  - CloudFront distribution
  - CDN caching configuration

---

## AWS Services

### Compute

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **AWS Lambda** | Serverless functions | Node.js 20.x, ESM format |
| **AWS Step Functions** | Workflow orchestration | Standard workflows |

### Storage

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Amazon S3** | Object storage | - CSV file uploads<br>- Static website hosting<br>- Lifecycle policies (prod) |
| **Amazon DynamoDB** | NoSQL database | - PAY_PER_REQUEST (dev)<br>- PROVISIONED (prod)<br>- Auto-scaling<br>- Point-in-time recovery |

### API & Integration

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **AWS AppSync** | GraphQL API | DynamoDB data sources |
| **Amazon API Gateway** | REST API | - CORS enabled<br>- Throttling limits |
| **Amazon EventBridge** | Event bus (future) | Currently not implemented |

### Content Delivery

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Amazon CloudFront** | CDN | - S3 origin<br>- Edge caching<br>- HTTPS only |

### Monitoring & Logging

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Amazon CloudWatch** | Logging & monitoring | - Lambda logs<br>- Step Functions logs<br>- Log retention<br>- Custom metrics |
| **AWS X-Ray** | Distributed tracing | Currently not implemented |

### Security & Identity

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **AWS IAM** | Access management | - Lambda execution roles<br>- Service-specific policies<br>- Least privilege principle |

### Cost Management

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **AWS Cost Explorer** | Cost tracking | API access for dashboard |

### Developer Tools

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **AWS CloudFormation** | Stack management | Generated by CDK |
| **AWS CodeBuild** | Build automation (future) | Currently not implemented |

---

## Development Tools

### Package Management

| Tool | Version | Purpose |
|------|---------|---------|
| **npm** | Latest | Package management |
| **Workspaces** | npm 7+ | Monorepo management |

### Code Quality

| Tool | Purpose | Configuration |
|------|---------|---------------|
| **ESLint** | TypeScript linting | `@typescript-eslint/*` rules |
| **Prettier** | Code formatting | Standard configuration |
| **TypeScript Compiler** | Type checking | Strict mode enabled |

### Testing

| Tool | Purpose | Configuration |
|------|---------|---------------|
| **Jest** | Unit testing | - ES modules support<br>- AWS SDK mocking<br>- Coverage reporting |
| **AWS SDK Mock** | Service mocking | DynamoDB, S3, Step Functions |

### Build Tools

| Tool | Purpose |
|------|---------|
| **esbuild** | Fast JavaScript bundling (via CDK) |
| **AWS CDK CLI** | Infrastructure deployment |

---

## CI/CD Pipeline

### GitHub Actions Workflows

#### 1. Deploy Workflow
- **File:** `.github/workflows/deploy.yml`
- **Triggers:** Manual (workflow_dispatch)
- **Stages:**
  - Dependency installation
  - AWS credential configuration
  - Drift detection and fixing
  - Pre-deployment cleanup
  - CDK deployment (all stacks)
  - Post-deployment summary
- **Environments:** dev, test, prod

#### 2. Destroy Workflow
- **File:** `.github/workflows/destroy.yml`
- **Triggers:** Manual (workflow_dispatch)
- **Requires:** Type "DESTROY" to confirm
- **Stages:**
  - Validation
  - CDK destroy (all stacks)
  - Orphaned resource cleanup
  - Destruction summary
- **Safety:** Production warning

#### 3. PR Preview Workflow
- **File:** `.github/workflows/pr-preview.yml`
- **Triggers:** PR opened/updated/closed
- **Features:**
  - Automatic preview environment creation
  - Table backup/restore for data preservation
  - PR comments with deployment URLs
  - Automatic cleanup on PR close
- **Environment naming:** `pr-{number}`

### Deployment Scripts

| Script | Purpose |
|--------|---------|
| `deploy-with-cleanup.sh` | Smart deployment with pre-cleanup |
| `fix-cloudformation-drift.sh` | Detect and fix stack drift |
| `cleanup-orphaned-resources.sh` | Comprehensive resource cleanup |
| `cleanup-all-pr-environments.sh` | Bulk PR environment cleanup |
| `backup-table.sh` | DynamoDB table backup |
| `restore-table.sh` | DynamoDB table restore |
| `import-all-tables.sh` | Import tables to CloudFormation |

---

## Environment Configuration

### Context Variables (CDK)

```json
{
  "dev": {
    "stage": "dev",
    "isProdLike": false,
    "region": "us-east-1"
  },
  "test": {
    "stage": "test",
    "isProdLike": true,
    "region": "us-east-1"
  },
  "prod": {
    "stage": "prod",
    "isProdLike": true,
    "region": "us-east-1"
  }
}
```

### Environment-Specific Configurations

| Feature | Dev | Test | Prod |
|---------|-----|------|------|
| **DynamoDB Billing** | PAY_PER_REQUEST | PROVISIONED | PROVISIONED |
| **DynamoDB Capacity** | On-demand | 5 RCU/WCU | 5 RCU/WCU |
| **Auto-scaling** | ❌ | ✅ | ✅ |
| **Point-in-time Recovery** | ❌ | ✅ | ✅ |
| **Deletion Protection** | ❌ | ✅ | ✅ |
| **RemovalPolicy** | DESTROY | RETAIN | RETAIN |
| **S3 Auto-delete** | ✅ | ❌ | ❌ |
| **S3 Lifecycle** | ❌ | ✅ (Glacier) | ✅ (Glacier) |
| **API Throttling** | 100/200 | 1000/2000 | 1000/2000 |

---

## Project Structure

```
.
├── .github/
│   └── workflows/           # CI/CD pipelines
│       ├── deploy.yml       # Deployment workflow
│       ├── destroy.yml      # Destruction workflow
│       └── pr-preview.yml   # PR preview environments
│
├── packages/
│   ├── infrastructure/      # AWS CDK code
│   │   ├── bin/            # CDK app entry point
│   │   ├── lib/            # CDK stacks
│   │   │   ├── database-stack.ts
│   │   │   ├── lambda-stack.ts
│   │   │   ├── appsync-stack.ts
│   │   │   ├── step-functions-stack.ts
│   │   │   ├── jira-dashboard-stack.ts
│   │   │   └── web-app-stack.ts
│   │   └── graphql/        # GraphQL schema & resolvers
│   │
│   ├── functions/          # Lambda function code
│   │   └── src/
│   │       ├── hello-world/
│   │       ├── jira-csv-processor/
│   │       ├── jira-process-batch/
│   │       ├── jira-start-processing/
│   │       ├── jira-finalize-upload/
│   │       ├── jira-get-upload-url/
│   │       ├── jira-get-dashboard-data/
│   │       ├── jira-get-historical-data/
│   │       ├── jira-list-uploads/
│   │       ├── jira-delete-upload/
│   │       ├── jira-get-upload-status/
│   │       └── get-costs/
│   │
│   └── web-app/            # Frontend applications
│       └── src/
│           ├── index.html          # Main app
│           └── jira-dashboard/     # Jira analytics
│               ├── index.html
│               ├── components/
│               └── utils/
│
└── scripts/                # Deployment & utility scripts
    ├── deploy-with-cleanup.sh
    ├── fix-cloudformation-drift.sh
    ├── cleanup-orphaned-resources.sh
    ├── cleanup-all-pr-environments.sh
    ├── backup-table.sh
    ├── restore-table.sh
    └── import-all-tables.sh
```

---

## Key Architectural Patterns

### 1. **Serverless Architecture**
- No server management
- Pay-per-use pricing
- Automatic scaling
- High availability

### 2. **Event-Driven Processing**
- S3 event notifications trigger Lambda
- Step Functions orchestrate workflows
- Asynchronous batch processing

### 3. **Infrastructure as Code**
- All infrastructure defined in TypeScript
- Version-controlled infrastructure
- Reproducible deployments
- Multi-environment support

### 4. **Monorepo Structure**
- npm workspaces for package management
- Shared dependencies
- Coordinated deployments
- Type safety across packages

### 5. **GitOps & CI/CD**
- GitHub Actions for automation
- Environment-specific workflows
- Automated testing and deployment
- Preview environments for PRs

---

## Cost Optimization Features

1. **Environment-based Resource Sizing**
   - Dev: Pay-per-request, smaller resources
   - Prod: Provisioned capacity with auto-scaling

2. **Resource Cleanup**
   - Automatic PR environment cleanup
   - Orphaned resource detection
   - S3 lifecycle policies (prod)

3. **Efficient Processing**
   - Batch processing (500 rows/batch)
   - High-memory Lambda for CSV processing
   - Step Functions for long-running workflows

4. **Cost Monitoring**
   - AWS Cost Explorer integration
   - Dashboard cost visualization
   - Environment-tagged resources

---

## Security Best Practices

1. **Least Privilege IAM**
   - Service-specific roles
   - Minimal permissions
   - No hardcoded credentials

2. **Encryption**
   - S3: AWS-managed encryption
   - DynamoDB: AWS-managed encryption
   - CloudFront: HTTPS only

3. **Network Security**
   - CORS configuration
   - API throttling
   - CloudFront security headers (future)

4. **Data Protection**
   - Point-in-time recovery (prod)
   - Deletion protection (prod)
   - Backup/restore scripts

---

## Future Enhancements

### Planned Features

- [ ] AWS X-Ray distributed tracing
- [ ] Amazon EventBridge integration
- [ ] AWS CodeBuild for CI/CD
- [ ] Amazon Cognito for authentication
- [ ] AWS WAF for API protection
- [ ] Amazon SQS for queue management
- [ ] AWS Secrets Manager for sensitive data
- [ ] CloudFront security headers
- [ ] Multi-region deployment
- [ ] Blue/Green deployments

---

## Version Information

| Component | Version |
|-----------|---------|
| Node.js | 20.x |
| TypeScript | 5.x |
| AWS CDK | 2.x |
| AWS SDK v3 | Latest |
| Chart.js | 4.x |

---

## Documentation Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [AWS Step Functions Documentation](https://docs.aws.amazon.com/step-functions/)
- [Amazon DynamoDB Documentation](https://docs.aws.amazon.com/dynamodb/)
- [AWS AppSync Documentation](https://docs.aws.amazon.com/appsync/)

---

**Last Updated:** January 1, 2026
