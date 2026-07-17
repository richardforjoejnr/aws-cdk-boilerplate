#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
// import { PipelineStack } from '../lib/pipeline-stack.js'; // Not needed - using GitHub Actions instead
import { DatabaseStack } from '../lib/database-stack.js';
import { LambdaStack } from '../lib/lambda-stack.js';
import { AppSyncStack } from '../lib/appsync-stack.js';
import { StepFunctionsStack } from '../lib/step-functions-stack.js';
import { BalanceBookingAuthStack } from '../lib/balance-booking/auth-stack.js';
import { BalanceBookingDataStack } from '../lib/balance-booking/data-stack.js';
import { BalanceBookingFunctionsStack } from '../lib/balance-booking/functions-stack.js';
import { BalanceBookingApiStack } from '../lib/balance-booking/api-stack.js';
import { BalanceBookingWebStack } from '../lib/balance-booking/web-stack.js';

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
const isDestroy = process.argv.includes('destroy');
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
