#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { __APP_PASCAL__Stack } from '../lib/__APP_NAME__-stack.js';

const app = new cdk.App();

// Stage from env (dev/test/prod); every resource is stage-prefixed so environments
// coexist in one account. This is a self-contained CDK app — deploying it never
// touches any other app's stacks.
const stage = process.env.STAGE ?? 'dev';
const isProd = stage === 'prod';

new __APP_PASCAL__Stack(app, `${stage}-__APP_NAME__`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  stackName: `${stage}-__APP_NAME__`,
  description: '__APP_TITLE__ (' + stage + ')',
  stage,
  isProd,
});

cdk.Tags.of(app).add('App', '__APP_NAME__');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
