#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack.js';
import { DatabaseStack } from '../lib/database-stack.js';
import { LambdaStack } from '../lib/lambda-stack.js';
import { AppSyncStack } from '../lib/appsync-stack.js';
import { StepFunctionsStack } from '../lib/step-functions-stack.js';

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

// Pipeline Stack - CI/CD pipeline (only for production account)
if (stage === 'prod') {
  new PipelineStack(app, `${stackPrefix}-pipeline`, {
    env,
    description: 'CI/CD pipeline for multi-environment deployment',
    stackName: `${stackPrefix}-pipeline`,
  });
}

// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'AWS-Boilerplate');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
