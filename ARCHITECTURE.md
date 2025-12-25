# AWS CDK Boilerplate - Architecture & Documentation

Complete guide to understanding how this AWS serverless boilerplate works.

## Table of Contents

1. [Overview](#overview)
2. [Repository Structure](#repository-structure)
3. [Core Components](#core-components)
4. [How It All Works Together](#how-it-all-works-together)
5. [Infrastructure Stacks](#infrastructure-stacks)
6. [Deployment Process](#deployment-process)
7. [Scripts Explained](#scripts-explained)
8. [Web Application](#web-application)
9. [GraphQL API](#graphql-api)
10. [Environment Management](#environment-management)
11. [Common Workflows](#common-workflows)

---

## Overview

This is a production-ready AWS serverless boilerplate built with:

- **AWS CDK** (Infrastructure as Code)
- **AppSync** (GraphQL API)
- **DynamoDB** (Database)
- **Lambda** (Serverless compute)
- **Step Functions** (Workflow orchestration)
- **CloudFront + S3** (Web app hosting)
- **React + Vite** (Frontend)

The architecture follows AWS best practices with multi-environment support (dev, test, prod).

---

## Repository Structure

```
AWS/
├── packages/                          # Monorepo workspaces
│   ├── functions/                     # Lambda function code
│   │   ├── src/
│   │   │   └── hello-world.ts        # Example Lambda handler
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── infrastructure/                # AWS CDK infrastructure code
│   │   ├── bin/
│   │   │   └── app.ts                # CDK app entry point
│   │   ├── lib/                      # CDK stack definitions
│   │   │   ├── database-stack.ts     # DynamoDB tables
│   │   │   ├── lambda-stack.ts       # Lambda functions
│   │   │   ├── appsync-stack.ts      # GraphQL API + resolvers
│   │   │   ├── step-functions-stack.ts # Workflows
│   │   │   └── web-app-stack.ts      # CloudFront + S3
│   │   ├── schema/
│   │   │   └── schema.graphql        # GraphQL schema definition
│   │   ├── cdk.json                  # CDK configuration
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web-app/                       # React frontend application
│       ├── src/
│       │   ├── App.tsx               # Main React component
│       │   ├── amplifyconfiguration.ts # AWS Amplify config
│       │   └── vite-env.d.ts         # TypeScript env types
│       ├── index.html
│       ├── vite.config.ts            # Vite bundler config
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/                           # Deployment & utility scripts
│   ├── deploy-with-cleanup.sh        # Smart deployment with pre-checks
│   ├── cleanup-orphaned-resources.sh # Clean up non-CFN resources
│   ├── fix-cloudformation-drift.sh   # Detect drift
│   ├── fix-drift-and-redeploy.sh     # Fix drift and redeploy
│   ├── deploy-webapp.sh              # Deploy web app only
│   ├── configure-webapp.sh           # Generate .env files
│   ├── validate-deployment.sh        # Post-deployment validation
│   ├── cleanup-failed-stacks.sh      # Remove failed stacks
│   └── [other scripts]
│
├── .github/
│   └── workflows/
│       ├── deploy.yml                # CI/CD for infrastructure
│       └── deploy-webapp.yml         # CI/CD for web app
│
├── package.json                       # Root workspace configuration
├── .gitignore
└── README.md
```

---

## Core Components

### 1. **AWS CDK (Cloud Development Kit)**

**What it is:** Infrastructure as Code framework that lets you define AWS resources using TypeScript.

**Location:** `packages/infrastructure/`

**How it works:**
- You write TypeScript classes that extend `cdk.Stack`
- CDK synthesizes these into CloudFormation templates
- CloudFormation deploys the actual AWS resources

**Example:**
```typescript
// packages/infrastructure/lib/database-stack.ts
const table = new dynamodb.Table(this, 'MainTable', {
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
});
```

This creates a real DynamoDB table in AWS.

### 2. **DynamoDB (Database)**

**What it is:** NoSQL database for storing application data.

**Stack:** `DatabaseStack` in `database-stack.ts`

**Schema:**
- **Primary Key:** Composite key (pk + sk) for single-table design
- **Attributes:** Flexible JSON-like documents
- **GSIs:** Global Secondary Indexes for alternative query patterns

**Current table:**
- Name: `{stage}-main-table` (e.g., `dev-main-table`)
- Key structure: `pk` (partition key) + `sk` (sort key)

### 3. **Lambda Functions**

**What it is:** Serverless compute - your code runs without managing servers.

**Stack:** `LambdaStack` in `lambda-stack.ts`

**Location:** Code in `packages/functions/src/`

**Current function:**
- **hello-world.ts** - Example Lambda that returns a greeting
- Triggered by AppSync GraphQL query

**How it works:**
1. Code is written in `packages/functions/src/`
2. CDK bundles it using esbuild
3. Deploys as a Lambda function
4. AppSync can invoke it via a resolver

### 4. **AppSync (GraphQL API)**

**What it is:** Managed GraphQL API service.

**Stack:** `AppSyncStack` in `appsync-stack.ts`

**Schema:** Defined in `packages/infrastructure/schema/schema.graphql`

**Components:**
- **Schema** - Defines queries, mutations, types
- **Resolvers** - Connect GraphQL operations to data sources (DynamoDB, Lambda)
- **Data Sources** - DynamoDB table, Lambda functions

**Authorization:**
- Primary: API Key (for development)
- Secondary: IAM (for service-to-service)

### 5. **Step Functions**

**What it is:** Workflow orchestration service.

**Stack:** `StepFunctionsStack` in `step-functions-stack.ts`

**Purpose:** Coordinate multiple Lambda functions in a workflow.

**Example workflow:**
1. Invoke hello-world Lambda
2. Wait for response
3. Complete

### 6. **Web Application (CloudFront + S3)**

**What it is:** Static React app hosted on S3, served via CloudFront CDN.

**Stack:** `WebAppStack` in `web-app-stack.ts`

**Components:**
- **S3 Bucket** - Stores built HTML/CSS/JS files
- **CloudFront Distribution** - CDN for fast global access
- **Origin Access Identity (OAI)** - Secure S3 access

**Build process:**
1. Vite builds React app to `dist/` folder
2. CDK deploys `dist/` to S3
3. CloudFront serves files from S3

---

## How It All Works Together

### Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         User's Browser                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  CloudFront (CDN)    │
                  │  ddts7p36npmom...    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │   S3 Bucket          │
                  │   (Static Files)     │
                  └──────────────────────┘

                  React App sends GraphQL queries
                             │
                             ▼
                  ┌──────────────────────┐
                  │  AppSync GraphQL API │
                  │  (API Gateway)       │
                  └──────────┬───────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
         ┌─────────────────┐  ┌─────────────┐
         │  DynamoDB       │  │  Lambda     │
         │  (Database)     │  │  Functions  │
         └─────────────────┘  └─────────────┘
                                      │
                                      ▼
                            ┌─────────────────┐
                            │ Step Functions  │
                            │ (Orchestration) │
                            └─────────────────┘
```

### Request Flow Example

**User creates an item in the web app:**

1. **Browser** → User clicks "Add Item" button
2. **React App** → Calls `createItem` GraphQL mutation via Amplify
3. **AppSync** → Receives mutation, routes to DynamoDB resolver
4. **Resolver** → Executes VTL template to build DynamoDB PutItem request
5. **DynamoDB** → Stores item with generated UUID as `pk`
6. **AppSync** → Returns created item to client
7. **React App** → Updates UI with new item

---

## Infrastructure Stacks

### Stack Dependency Order

```
1. DatabaseStack (DynamoDB tables)
          ↓
2. LambdaStack (needs database reference)
          ↓
3. AppSyncStack (needs database + lambda)
          ↓
4. StepFunctionsStack (needs lambda)
          ↓
5. WebAppStack (optional - frontend)
```

### 1. DatabaseStack

**File:** `packages/infrastructure/lib/database-stack.ts`

**Resources Created:**
- DynamoDB table: `{stage}-main-table`
- Table configuration:
  - Partition key: `pk` (string)
  - Sort key: `sk` (string)
  - Billing mode: PAY_PER_REQUEST (serverless)
  - Point-in-time recovery: Enabled (prod)
  - Deletion protection: Enabled (prod)
  - Stream: NEW_AND_OLD_IMAGES

**Outputs:**
- `MainTableName` - Table name
- `MainTableArn` - Table ARN for IAM policies
- `MainTableStreamArn` - Stream ARN for triggers

### 2. LambdaStack

**File:** `packages/infrastructure/lib/lambda-stack.ts`

**Resources Created:**
- Lambda function: `{stage}-hello-world`
- CloudWatch log group: `/aws/lambda/{stage}-hello-world`
- IAM role with DynamoDB permissions

**Environment Variables Passed to Lambda:**
- `TABLE_NAME` - DynamoDB table name
- `STAGE` - Current environment (dev/test/prod)

**Configuration:**
- Runtime: Node.js 18
- Architecture: ARM64 (cheaper, faster)
- Memory: 512 MB (prod), 256 MB (dev/test)
- Timeout: 30 seconds (prod), 10 seconds (dev/test)

### 3. AppSyncStack

**File:** `packages/infrastructure/lib/appsync-stack.ts`

**Resources Created:**
- GraphQL API: `{stage}-api`
- API Key (expires in 365 days)
- Data sources (DynamoDB, Lambda)
- Resolvers for each GraphQL operation

**Resolvers:**

| GraphQL Operation | Type     | Data Source | Purpose              |
|-------------------|----------|-------------|----------------------|
| `getItem`         | Query    | DynamoDB    | Get item by ID       |
| `listItems`       | Query    | DynamoDB    | List all items       |
| `createItem`      | Mutation | DynamoDB    | Create new item      |
| `updateItem`      | Mutation | DynamoDB    | Update existing item |
| `deleteItem`      | Mutation | DynamoDB    | Delete item          |
| `hello`           | Query    | Lambda      | Invoke hello-world   |

**Resolver Implementation:**
Resolvers use VTL (Velocity Template Language) to transform GraphQL requests into DynamoDB operations.

Example - Delete Item Resolver:
```vtl
{
  "version": "2017-02-28",
  "operation": "DeleteItem",
  "key": {
    "pk": $util.dynamodb.toDynamoDBJson($ctx.args.id),
    "sk": $util.dynamodb.toDynamoDBJson("ITEM")
  }
}
```

**Outputs:**
- `GraphQLApiUrl` - API endpoint
- `GraphQLApiKey` - API key for authentication
- `GraphQLApiId` - API ID

### 4. StepFunctionsStack

**File:** `packages/infrastructure/lib/step-functions-stack.ts`

**Resources Created:**
- State Machine: `{stage}-hello-world-state-machine`
- CloudWatch log group for execution logs

**Workflow:**
Simple example that invokes the hello-world Lambda function.

### 5. WebAppStack

**File:** `packages/infrastructure/lib/web-app-stack.ts`

**Resources Created:**
- S3 bucket: `{stage}-aws-boilerplate-webapp`
- CloudFront distribution
- Origin Access Identity (OAI)
- Bucket deployment (copies `dist/` to S3)

**CloudFront Configuration:**
- Default root object: `index.html`
- Error handling: Redirects to `/index.html` for SPA routing
- HTTPS only
- Caching: Optimized for static assets

**Outputs:**
- `WebAppUrl` - CloudFront URL (e.g., https://ddts7p36npmom.cloudfront.net)
- `CloudFrontDistributionId` - For cache invalidation
- `S3BucketName` - Bucket name

---

## Deployment Process

### What Happens During Deployment

#### 1. Pre-Deployment (Cleanup Phase)

**Script:** `scripts/cleanup-orphaned-resources.sh`

**Actions:**
- Checks for orphaned DynamoDB tables (not managed by CloudFormation)
- Checks for orphaned CloudWatch log groups
- Removes failed CloudFormation stacks
- Optionally backs up data before deletion

**Why needed:**
Sometimes resources get created outside of CloudFormation (manual testing, drift), which causes deployment failures.

#### 2. Drift Detection

**Script:** `scripts/fix-cloudformation-drift.sh`

**Actions:**
- Compares CloudFormation state vs. actual AWS resources
- Detects if resources were manually deleted or modified
- Reports drift status

**Common drift scenarios:**
- Table deleted manually but CloudFormation thinks it exists
- Lambda function modified via console
- IAM roles changed manually

#### 3. Build Phase

**Command:** `npm run build`

**Actions:**
- Compiles TypeScript to JavaScript for all packages
- Functions: `packages/functions/` → Lambda-ready code
- Infrastructure: `packages/infrastructure/` → CDK constructs
- Web App: `packages/web-app/` → Vite build to `dist/`

#### 4. CDK Deployment

**Command:** `npx cdk deploy --all`

**Process:**
1. **Synthesis**
   - CDK converts TypeScript code to CloudFormation JSON
   - Validates constructs
   - Creates `cdk.out/` directory with templates

2. **Bootstrap (first time only)**
   - Creates CDK toolkit stack
   - S3 bucket for deployment assets
   - IAM roles for deployment

3. **Diff**
   - Compares existing stacks with new templates
   - Shows what will change

4. **Deploy**
   - Uploads assets (Lambda code, web app files) to S3
   - Creates/updates CloudFormation stacks in order
   - Waits for each stack to complete

5. **Outputs**
   - Displays stack outputs (URLs, ARNs, etc.)

#### 5. Post-Deployment

**Script:** `scripts/validate-deployment.sh`

**Actions:**
- Verifies all stacks deployed successfully
- Tests GraphQL API endpoints
- Checks web app is accessible
- Validates environment configuration

---

## Scripts Explained

### `deploy-with-cleanup.sh`

**Purpose:** Smart deployment that handles common issues automatically.

**Usage:**
```bash
./scripts/deploy-with-cleanup.sh [dev|test|prod] [--skip-cleanup] [--webapp]
```

**Workflow:**
1. Validates AWS credentials
2. Runs cleanup of orphaned resources
3. Detects CloudFormation drift
4. Builds all packages
5. Deploys infrastructure stacks
6. Optionally deploys web app (if `--webapp` flag)
7. Fetches and displays deployment outputs
8. Saves outputs to `.deployment-outputs-{stage}.json`

**Example:**
```bash
npm run deploy:dev:webapp
# Runs: ./scripts/deploy-with-cleanup.sh dev --webapp
```

### `cleanup-orphaned-resources.sh`

**Purpose:** Clean up AWS resources not managed by CloudFormation.

**What it cleans:**
- Orphaned DynamoDB tables
- Orphaned CloudWatch log groups
- Failed CloudFormation stacks

**Safety features:**
- Checks if resource is managed by CloudFormation before deleting
- Warns if table contains data
- Skips deletion of tables with data

### `fix-cloudformation-drift.sh`

**Purpose:** Detect drift between CloudFormation and actual AWS state.

**How it works:**
1. Queries CloudFormation for expected resources
2. Checks if resources actually exist in AWS
3. Reports any mismatches

**Example output:**
```
✓ No drift detected

OR

⚠️ Drift detected:
  - dev-main-table: CloudFormation says EXISTS, but actual state is DELETED
```

### `configure-webapp.sh`

**Purpose:** Generate environment configuration for web app.

**Usage:**
```bash
./scripts/configure-webapp.sh [dev|test|prod]
```

**What it does:**
1. Fetches AppSync API URL, Key, ID from CloudFormation outputs
2. Creates `packages/web-app/.env.{stage}` file
3. Copies to `packages/web-app/.env` for Vite build

**Generated file:**
```bash
VITE_STAGE=dev
VITE_AWS_REGION=us-east-1
VITE_GRAPHQL_API_URL=https://xxx.appsync-api.us-east-1.amazonaws.com/graphql
VITE_GRAPHQL_API_KEY=da2-xxxxxxxxxxxx
VITE_GRAPHQL_API_ID=xxxxxxxxxxxx
```

### `deploy-webapp.sh`

**Purpose:** Deploy only the web application (faster than full deployment).

**Usage:**
```bash
./scripts/deploy-webapp.sh [dev|test|prod]
```

**Workflow:**
1. Configures web app (generates `.env` file)
2. Builds React app with Vite
3. Deploys to CloudFront + S3 using CDK
4. Invalidates CloudFront cache

**When to use:**
- Frontend-only changes
- Faster iteration during UI development
- API hasn't changed

### `validate-deployment.sh`

**Purpose:** Verify deployment succeeded and everything works.

**Checks:**
- All stacks exist and are in `CREATE_COMPLETE` or `UPDATE_COMPLETE` status
- GraphQL API is accessible
- Web app URL returns 200 OK
- Database table exists and is active

---

## Web Application

### Technology Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Fast build tool and dev server
- **AWS Amplify** - AWS SDK for web
- **TailwindCSS** - Utility-first CSS

### File Structure

```
packages/web-app/src/
├── App.tsx                    # Main component with CRUD UI
├── amplifyconfiguration.ts    # AWS Amplify configuration
├── vite-env.d.ts             # TypeScript environment types
├── main.tsx                   # App entry point
└── index.css                  # Global styles
```

### How the Web App Connects to AWS

#### 1. Configuration (`amplifyconfiguration.ts`)

```typescript
const apiUrl = import.meta.env.VITE_GRAPHQL_API_URL;
const apiKey = import.meta.env.VITE_GRAPHQL_API_KEY;

export const amplifyConfig = {
  aws_appsync_graphqlEndpoint: apiUrl,
  aws_appsync_authenticationType: 'API_KEY',
  aws_appsync_apiKey: apiKey,
};
```

**Environment variables** are injected at build time from `.env` file.

#### 2. Amplify Initialization (`main.tsx`)

```typescript
import { Amplify } from 'aws-amplify';
import { amplifyConfig } from './amplifyconfiguration';

Amplify.configure(amplifyConfig);
```

#### 3. GraphQL Operations (`App.tsx`)

**List Items:**
```typescript
const items = await client.graphql({
  query: `query ListItems {
    listItems { pk name description }
  }`
});
```

**Create Item:**
```typescript
await client.graphql({
  query: `mutation CreateItem($input: CreateItemInput!) {
    createItem(input: $input) { pk name }
  }`,
  variables: {
    input: { name: "New Item", description: "Description" }
  }
});
```

**Delete Item:**
```typescript
await client.graphql({
  query: `mutation DeleteItem($id: ID!) {
    deleteItem(id: $id) { pk }
  }`,
  variables: { id: itemId }
});
```

### Build Process

**Development:**
```bash
npm run webapp:dev
# Starts Vite dev server on http://localhost:5173
```

**Production Build:**
```bash
npm run build
# Compiles TypeScript
# Bundles with Vite
# Outputs to dist/
```

**Deploy:**
```bash
npm run deploy:webapp:dev
# Builds and deploys to CloudFront
```

---

## GraphQL API

### Schema Definition

**File:** `packages/infrastructure/schema/schema.graphql`

```graphql
type Item {
  pk: ID!
  sk: String
  name: String!
  description: String
  createdAt: AWSDateTime
  updatedAt: AWSDateTime
}

input CreateItemInput {
  name: String!
  description: String
}

input UpdateItemInput {
  name: String!
  description: String
}

type Query {
  getItem(id: ID!): Item
  listItems: [Item]
  hello: String
}

type Mutation {
  createItem(input: CreateItemInput!): Item
  updateItem(id: ID!, input: UpdateItemInput!): Item
  deleteItem(id: ID!): Item
}

schema {
  query: Query
  mutation: Mutation
}
```

### Resolver Mapping Templates

AppSync uses **VTL (Velocity Template Language)** to transform GraphQL operations into backend requests.

#### Example: Create Item

**Request Template:**
```vtl
{
  "version": "2017-02-28",
  "operation": "PutItem",
  "key": {
    "pk": $util.dynamodb.toDynamoDBJson($util.autoId()),
    "sk": $util.dynamodb.toDynamoDBJson("ITEM")
  },
  "attributeValues": {
    "name": $util.dynamodb.toDynamoDBJson($ctx.args.input.name),
    "description": $util.dynamodb.toDynamoDBJson($ctx.args.input.description),
    "createdAt": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
    "updatedAt": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601())
  }
}
```

**What it does:**
1. Generates unique ID with `$util.autoId()`
2. Sets partition key (`pk`) to the ID
3. Sets sort key (`sk`) to `"ITEM"`
4. Adds name and description from input
5. Adds timestamps

**Response Template:**
```vtl
$util.toJson($ctx.result)
```

Returns the created item as JSON.

### Testing GraphQL API

**Using curl:**
```bash
API_URL="https://xxx.appsync-api.us-east-1.amazonaws.com/graphql"
API_KEY="da2-xxxxxxxxxxxx"

curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "query": "query { listItems { pk name } }"
  }'
```

**Using AppSync Console:**
1. Open AppSync console
2. Select your API
3. Click "Queries" tab
4. Write queries interactively

---

## Environment Management

### Multi-Environment Support

This boilerplate supports 3 environments:

| Environment | Stage | Use Case                    |
|-------------|-------|-----------------------------|
| Development | dev   | Local development & testing |
| Test        | test  | QA & staging                |
| Production  | prod  | Live production workloads   |

### Environment-Specific Configuration

**CDK Context (`packages/infrastructure/cdk.json`):**

```json
{
  "dev": {
    "stage": "dev",
    "isProdLike": false
  },
  "test": {
    "stage": "test",
    "isProdLike": false
  },
  "prod": {
    "stage": "prod",
    "isProdLike": true
  }
}
```

**In Stack Code:**

```typescript
const stage = this.node.tryGetContext('stage') as string;
const isProdLike = this.node.tryGetContext('isProdLike') as boolean;

// Different config for prod
const memory = isProdLike ? 512 : 256;
const deletionProtection = isProdLike;
```

### Resource Naming Convention

All resources are prefixed with `{stage}-`:

- DynamoDB: `dev-main-table`, `prod-main-table`
- Lambda: `dev-hello-world`, `prod-hello-world`
- Stacks: `dev-aws-boilerplate-database`, `prod-aws-boilerplate-database`

**Benefits:**
- Resources isolated per environment
- No name conflicts
- Easy identification in AWS console

### Deploying to Different Environments

```bash
# Development
npm run deploy:dev
STAGE=dev npx cdk deploy --all

# Test
npm run deploy:test
STAGE=test npx cdk deploy --all

# Production
npm run deploy:prod
STAGE=prod npx cdk deploy --all
```

---

## Common Workflows

### 1. Fresh Deployment

```bash
# Deploy infrastructure + web app to dev
npm run deploy:dev:webapp
```

### 2. Update Backend Only

```bash
# Make changes to Lambda, DynamoDB, AppSync, etc.
npm run build
cd packages/infrastructure
STAGE=dev npx cdk deploy --all
```

### 3. Update Frontend Only

```bash
# Make changes to React app
npm run deploy:webapp:dev
```

### 4. Add New Lambda Function

**Step 1:** Create function
```typescript
// packages/functions/src/my-new-function.ts
export const handler = async (event: any) => {
  return { statusCode: 200, body: 'Hello' };
};
```

**Step 2:** Add to LambdaStack
```typescript
// packages/infrastructure/lib/lambda-stack.ts
const myFunction = new lambda.Function(this, 'MyNewFunction', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('dist/my-new-function'),
});

// Export for other stacks
this.myNewFunction = myFunction;
```

**Step 3:** Add to AppSync (if needed)
```typescript
// packages/infrastructure/lib/appsync-stack.ts
const dataSource = this.api.addLambdaDataSource(
  'MyDataSource',
  props.myNewFunction
);

dataSource.createResolver('MyResolver', {
  typeName: 'Query',
  fieldName: 'myQuery',
});
```

**Step 4:** Deploy
```bash
npm run build
npm run deploy:dev
```

### 5. Add GraphQL Operation

**Step 1:** Update schema
```graphql
// packages/infrastructure/schema/schema.graphql
type Query {
  myNewQuery(id: ID!): MyType
}

type MyType {
  id: ID!
  value: String
}
```

**Step 2:** Add resolver
```typescript
// packages/infrastructure/lib/appsync-stack.ts
dynamoDbDataSource.createResolver('MyResolver', {
  typeName: 'Query',
  fieldName: 'myNewQuery',
  requestMappingTemplate: appsync.MappingTemplate.fromString(`...`),
  responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
});
```

**Step 3:** Deploy
```bash
npm run deploy:dev
```

**Step 4:** Use in frontend
```typescript
const result = await client.graphql({
  query: `query MyNewQuery($id: ID!) {
    myNewQuery(id: $id) { id value }
  }`,
  variables: { id: '123' }
});
```

### 6. Debugging Issues

**Check CloudFormation:**
```bash
aws cloudformation describe-stacks --stack-name dev-aws-boilerplate-appsync
```

**Check Lambda logs:**
```bash
aws logs tail /aws/lambda/dev-hello-world --follow
```

**Check AppSync logs:**
```bash
aws logs tail /aws/appsync/apis/{api-id} --follow
```

**Test GraphQL API directly:**
```bash
./scripts/configure-webapp.sh dev
# Use the API URL and Key to test with curl or Postman
```

### 7. Destroy Everything

```bash
# Destroy all stacks in dev
npm run destroy:dev

# Clean up orphaned resources
./scripts/cleanup-orphaned-resources.sh dev
```

---

## Key Concepts

### Single-Table Design (DynamoDB)

Instead of multiple tables, we use one table with composite keys:

```
pk                                    | sk      | name      | description
-------------------------------------|---------|-----------|-------------
550e8400-e29b-41d4-a716-446655440000 | ITEM    | Item 1    | Description
550e8400-e29b-41d4-a716-446655440001 | ITEM    | Item 2    | Description
```

**Benefits:**
- Fewer tables to manage
- Better cost efficiency
- Flexible access patterns with GSIs

### CloudFormation Drift

**What is drift?**
When actual AWS resources differ from what CloudFormation expects.

**Common causes:**
- Manual changes via AWS console
- External scripts modifying resources
- Resources deleted outside CloudFormation

**How we handle it:**
- `fix-cloudformation-drift.sh` - Detects drift
- `deploy-with-cleanup.sh` - Automatically checks for drift before deployment
- Prevention via proper workflows

### VTL (Velocity Template Language)

Template language used by AppSync resolvers to transform requests.

**Common utilities:**
- `$util.autoId()` - Generate UUID
- `$util.time.nowISO8601()` - Current timestamp
- `$util.dynamodb.toDynamoDBJson()` - Convert to DynamoDB format
- `$ctx.args` - GraphQL arguments
- `$ctx.result` - Operation result

### CDK Constructs

Reusable cloud components. Three levels:

1. **L1 (CFN Resources)** - Direct CloudFormation (e.g., `CfnTable`)
2. **L2 (Constructs)** - AWS-provided abstractions (e.g., `Table`)
3. **L3 (Patterns)** - High-level patterns (e.g., `ApiGatewayToLambda`)

We mainly use L2 constructs.

---

## Troubleshooting

### Build Fails

**Error:** `Cannot find name 'ImportMetaEnv'`
**Fix:** Ensure `vite-env.d.ts` exists and is not in `.gitignore`

**Error:** `Module not found`
**Fix:** Run `npm install` in root and all packages

### Deployment Fails

**Error:** `Resource already exists`
**Fix:** Run cleanup script: `./scripts/cleanup-orphaned-resources.sh dev`

**Error:** `Stack is in UPDATE_ROLLBACK_COMPLETE`
**Fix:** Delete failed stack: `./scripts/cleanup-failed-stacks.sh dev`

### Web App Issues

**Error:** `ERR_NAME_NOT_RESOLVED` when loading app
**Fix:** Web app not deployed. Run `npm run deploy:webapp:dev`

**Error:** `Failed to fetch items`
**Fix:** Wrong API URL. Run `./scripts/configure-webapp.sh dev` then rebuild

**CloudFront shows old version:**
**Fix:** Wait for cache invalidation or manually invalidate:
```bash
aws cloudfront create-invalidation --distribution-id EAVL27A26AG76 --paths "/*"
```

### GraphQL Errors

**Error:** `The provided key element does not match the schema`
**Fix:** Resolver using wrong key format. Check resolver template uses `pk` + `sk`

**Error:** `Not Authorized`
**Fix:** Check API key is valid and not expired

---

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AppSync Resolver Mapping Template Reference](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-mapping-template-reference.html)
- [DynamoDB Single-Table Design](https://www.alexdebrie.com/posts/dynamodb-single-table/)
- [Vite Documentation](https://vitejs.dev/)

---

## Summary

This boilerplate provides a complete serverless application architecture:

✅ **Infrastructure as Code** - Everything defined in TypeScript
✅ **Multi-environment** - dev, test, prod isolation
✅ **GraphQL API** - Type-safe API with AppSync
✅ **Serverless Database** - DynamoDB with single-table design
✅ **Serverless Compute** - Lambda functions
✅ **Modern Frontend** - React + Vite + TypeScript
✅ **CI/CD Ready** - GitHub Actions workflows
✅ **Production Ready** - Drift detection, cleanup, validation

Start building by modifying the existing components or adding new ones following the patterns described above!
