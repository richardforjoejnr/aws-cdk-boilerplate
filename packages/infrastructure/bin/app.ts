#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
// import { PipelineStack } from '../lib/pipeline-stack.js'; // Not needed - using GitHub Actions instead
import { DatabaseStack } from '../lib/database-stack.js';
import { LambdaStack } from '../lib/lambda-stack.js';
import { AppSyncStack } from '../lib/appsync-stack.js';
import { StepFunctionsStack } from '../lib/step-functions-stack.js';
import { WebAppStack } from '../lib/web-app-stack.js';
import { JiraDashboardStack } from '../lib/jira-dashboard-stack.js';
import { BalanceBookingAuthStack } from '../lib/balance-booking/auth-stack.js';
import { BalanceBookingDataStack } from '../lib/balance-booking/data-stack.js';
import { BalanceBookingFunctionsStack } from '../lib/balance-booking/functions-stack.js';
import { BalanceBookingApiStack } from '../lib/balance-booking/api-stack.js';
import { BalanceBookingWebStack } from '../lib/balance-booking/web-stack.js';
import { GhanaPaymentsFoundationStack } from '../lib/ghana-payments/foundation-stack.js';
import { GhanaPaymentsSpikeStack } from '../lib/ghana-payments/spike-stack.js';
import { GhanaPaymentsApiStack } from '../lib/ghana-payments/api-stack.js';
import { GhanaPaymentsWebStack } from '../lib/ghana-payments/web-stack.js';

const app = new cdk.App();

// Get stage from environment variable, default to 'dev'
const stage = process.env.STAGE || 'dev';
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

const env = {
  account,
  region,
};

// Determine if this is a production-like environment
// PR preview environments (pr-*) are treated as dev-like
const isProdLike = stage === 'prod' || stage === 'test';

// Set context values for all stacks
app.node.setContext('stage', stage);
app.node.setContext('isProdLike', isProdLike);

// Stack naming convention: {stage}-{service}
const stackPrefix = `${stage}-aws-boilerplate`;

// Database Stack - DynamoDB tables
const databaseStack = new DatabaseStack(app, `${stackPrefix}-database`, {
  env,
  description: `DynamoDB tables for ${stage} environment`,
  stackName: `${stackPrefix}-database`,
});

// Lambda Stack - Contains all Lambda functions
const lambdaStack = new LambdaStack(app, `${stackPrefix}-lambda`, {
  env,
  description: `Lambda functions for ${stage} environment`,
  stackName: `${stackPrefix}-lambda`,
});

// AppSync Stack - GraphQL API
new AppSyncStack(app, `${stackPrefix}-appsync`, {
  env,
  description: `AppSync GraphQL API for ${stage} environment`,
  stackName: `${stackPrefix}-appsync`,
  mainTable: databaseStack.mainTable,
  helloWorldFunction: lambdaStack.helloWorldFunction,
});

// Step Functions Stack - Contains state machines
new StepFunctionsStack(app, `${stackPrefix}-step-functions`, {
  env,
  description: `Step Functions state machines for ${stage} environment`,
  stackName: `${stackPrefix}-step-functions`,
  helloWorldFunction: lambdaStack.helloWorldFunction,
});

// Jira Dashboard Stack - Complete Jira analytics dashboard
new JiraDashboardStack(app, `${stackPrefix}-jira-dashboard`, {
  env,
  description: `Jira Dashboard for ${stage} environment`,
  stackName: `${stackPrefix}-jira-dashboard`,
});

// Web App Stack - Static website hosting (S3 + CloudFront)
// Deploy if:
// - DEPLOY_WEBAPP=true (explicit deployment)
// - 'web-app' in arguments (targeting specific stack)
// - 'destroy' in arguments (need to include in destroy operation)
const isDestroy = process.argv.includes('destroy');
const deployWebApp = process.env.DEPLOY_WEBAPP === 'true' || process.argv.includes('web-app') || isDestroy;
if (deployWebApp) {
  new WebAppStack(app, `${stackPrefix}-web-app`, {
    env,
    description: `Web application hosting for ${stage} environment`,
    stackName: `${stackPrefix}-web-app`,
  });
}

// Balance Booking System (POC) - Pilates studio booking app
const balancePrefix = `${stage}-balance-booking`;
const balanceCommonProps = { stage, isProdLike } as const;

const balanceAuthStack = new BalanceBookingAuthStack(app, `${balancePrefix}-auth`, {
  env,
  description: `Cognito user pool for Balance Booking ${stage}`,
  stackName: `${balancePrefix}-auth`,
  ...balanceCommonProps,
});

const balanceDataStack = new BalanceBookingDataStack(app, `${balancePrefix}-data`, {
  env,
  description: `DynamoDB table for Balance Booking ${stage}`,
  stackName: `${balancePrefix}-data`,
  ...balanceCommonProps,
});

const balanceFunctionsStack = new BalanceBookingFunctionsStack(
  app,
  `${balancePrefix}-functions`,
  {
    env,
    description: `Lambda functions for Balance Booking ${stage}`,
    stackName: `${balancePrefix}-functions`,
    ...balanceCommonProps,
    bookingTable: balanceDataStack.bookingTable,
  }
);

new BalanceBookingApiStack(app, `${balancePrefix}-api`, {
  env,
  description: `AppSync GraphQL API for Balance Booking ${stage}`,
  stackName: `${balancePrefix}-api`,
  ...balanceCommonProps,
  userPool: balanceAuthStack.userPool,
  functions: balanceFunctionsStack.functions,
});

const deployBalanceWeb =
  process.env.DEPLOY_BALANCE_WEB === 'true' ||
  process.argv.includes('balance-booking-web') ||
  isDestroy;
if (deployBalanceWeb) {
  new BalanceBookingWebStack(app, `${balancePrefix}-web`, {
    env,
    description: `S3 + CloudFront hosting for Balance Booking ${stage}`,
    stackName: `${balancePrefix}-web`,
    ...balanceCommonProps,
  });
}

// Ghana Payments PoC — street vendor digital payment & soundbox platform
// Design: packages/ghana-payments/docs/planning/architecture.md
const ghanaPrefix = `${stage}-ghana-payments`;
// PoC: only prod retains data. test/pr-* stay fully destroyable (RETAIN +
// deletion protection on a PoC test stage just strands tables on teardown).
const ghanaProdLike = stage === 'prod';
const ghanaFoundation = new GhanaPaymentsFoundationStack(app, `${ghanaPrefix}-foundation`, {
  env,
  description: `Ghana Payments PoC data & event layer for ${stage}`,
  stackName: `${ghanaPrefix}-foundation`,
  stage,
  isProdLike: ghanaProdLike,
});

const ghanaApi = new GhanaPaymentsApiStack(app, `${ghanaPrefix}-api`, {
  env,
  description: `Ghana Payments PoC payment core (API, webhook, sweeper) for ${stage}`,
  stackName: `${ghanaPrefix}-api`,
  stage,
  isProdLike: ghanaProdLike,
  foundation: ghanaFoundation,
});

new GhanaPaymentsWebStack(app, `${ghanaPrefix}-web`, {
  env,
  description: `Ghana Payments PoC portals (CloudFront + S3 + /api routing) for ${stage}`,
  stackName: `${ghanaPrefix}-web`,
  stage,
  isProdLike: ghanaProdLike,
  apiStack: ghanaApi,
});

// Phase 0 spike (throwaway) — deployed only on explicit request
if (process.env.DEPLOY_GHANA_SPIKE === 'true') {
  new GhanaPaymentsSpikeStack(app, `${ghanaPrefix}-spike`, {
    env,
    description: `Ghana Payments Phase 0 spike (throwaway) for ${stage}`,
    stackName: `${ghanaPrefix}-spike`,
    stage,
  });
}

// Pipeline Stack - AWS CodePipeline (disabled - using GitHub Actions instead)
// GitHub Actions provides better integration and is already configured in .github/workflows/
// if (stage === 'prod') {
//   new PipelineStack(app, `${stackPrefix}-pipeline`, {
//     env,
//     description: 'CI/CD pipeline for multi-environment deployment',
//     stackName: `${stackPrefix}-pipeline`,
//   });
// }

// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'AWS-Boilerplate');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
