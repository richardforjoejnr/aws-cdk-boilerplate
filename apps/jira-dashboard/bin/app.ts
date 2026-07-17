#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { JiraDashboardStack } from '../lib/jira-dashboard-stack.js';
import { JiraWebStack } from '../lib/web-stack.js';

const app = new cdk.App();

// Self-contained CDK app — deploying it only ever touches jira-dashboard stacks.
const stage = process.env.STAGE ?? 'dev';
app.node.setContext('stage', stage);
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new JiraDashboardStack(app, `${stage}-jira-dashboard`, {
  env,
  stackName: `${stage}-jira-dashboard`,
  description: `Jira Dashboard (backend) for ${stage}`,
});

// Static site (S3 + CloudFront) serving the pre-built dashboard UI (apps/jira-dashboard/web-app/dist).
// Deployed only when the web bundle exists (deploy.sh builds it after the backend).
if (process.env.DEPLOY_WEB === 'true') {
  new JiraWebStack(app, `${stage}-jira-dashboard-web`, {
    env,
    stackName: `${stage}-jira-dashboard-web`,
    description: `Jira Dashboard (web) for ${stage}`,
  });
}

cdk.Tags.of(app).add('App', 'jira-dashboard');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
