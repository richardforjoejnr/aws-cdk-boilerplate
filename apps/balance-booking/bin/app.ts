#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BalanceBookingAuthStack } from '../lib/auth-stack.js';
import { BalanceBookingDataStack } from '../lib/data-stack.js';
import { BalanceBookingFunctionsStack } from '../lib/functions-stack.js';
import { BalanceBookingApiStack } from '../lib/api-stack.js';
import { BalanceBookingWebStack } from '../lib/web-stack.js';

const app = new cdk.App();

// Self-contained CDK app — deploying it only ever touches balance-booking stacks.
const stage = process.env.STAGE ?? 'dev';
const isProdLike = stage === 'prod' || stage === 'test';
const isDestroy = process.argv.includes('destroy');
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
const prefix = `${stage}-balance-booking`;
const common = { stage, isProdLike } as const;

const auth = new BalanceBookingAuthStack(app, `${prefix}-auth`, {
  env,
  stackName: `${prefix}-auth`,
  description: `Cognito user pool for Balance Booking ${stage}`,
  ...common,
});

const data = new BalanceBookingDataStack(app, `${prefix}-data`, {
  env,
  stackName: `${prefix}-data`,
  description: `DynamoDB table for Balance Booking ${stage}`,
  ...common,
});

const functions = new BalanceBookingFunctionsStack(app, `${prefix}-functions`, {
  env,
  stackName: `${prefix}-functions`,
  description: `Lambda functions for Balance Booking ${stage}`,
  ...common,
  bookingTable: data.bookingTable,
});

new BalanceBookingApiStack(app, `${prefix}-api`, {
  env,
  stackName: `${prefix}-api`,
  description: `AppSync GraphQL API for Balance Booking ${stage}`,
  ...common,
  userPool: auth.userPool,
  functions: functions.functions,
});

// Web (S3 + CloudFront) — built by deploy.sh, then deployed. Included on destroy.
if (process.env.DEPLOY_BALANCE_WEB === 'true' || process.argv.includes('balance-booking-web') || isDestroy) {
  new BalanceBookingWebStack(app, `${prefix}-web`, {
    env,
    stackName: `${prefix}-web`,
    description: `S3 + CloudFront hosting for Balance Booking ${stage}`,
    ...common,
  });
}

cdk.Tags.of(app).add('App', 'balance-booking');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
