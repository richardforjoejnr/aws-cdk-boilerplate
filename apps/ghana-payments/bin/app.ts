#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GhanaPaymentsFoundationStack } from '../lib/foundation-stack.js';
import { GhanaPaymentsApiStack } from '../lib/api-stack.js';
import { GhanaPaymentsWebStack } from '../lib/web-stack.js';
import { GhanaPaymentsFleetProvisioningStack } from '../lib/fleet-provisioning-stack.js';
import { GhanaPaymentsSpikeStack } from '../lib/spike-stack.js';

const app = new cdk.App();

// Self-contained CDK app — deploying it only ever touches ghana-payments stacks.
const stage = process.env.STAGE ?? 'dev';
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
const prefix = `${stage}-ghana-payments`;
// PoC decision: NO stage retains data — every environment destroys to zero.
const isProdLike = false;

const foundation = new GhanaPaymentsFoundationStack(app, `${prefix}-foundation`, {
  env,
  stackName: `${prefix}-foundation`,
  description: `Ghana Payments data & event layer for ${stage}`,
  stage,
  isProdLike,
});

const api = new GhanaPaymentsApiStack(app, `${prefix}-api`, {
  env,
  stackName: `${prefix}-api`,
  description: `Ghana Payments payment core (API, webhook, sweeper) for ${stage}`,
  stage,
  isProdLike,
  foundation,
});

new GhanaPaymentsWebStack(app, `${prefix}-web`, {
  env,
  stackName: `${prefix}-web`,
  description: `Ghana Payments portals (CloudFront + S3 + /api routing) for ${stage}`,
  stage,
  isProdLike,
  apiStack: api,
});

// IoT Fleet Provisioning by Claim — the fleet's provisioning template, claim +
// device policies, and pre-provisioning hook. Independent of the API stack.
new GhanaPaymentsFleetProvisioningStack(app, `${prefix}-fleet`, {
  env,
  stackName: `${prefix}-fleet`,
  description: `Ghana Payments soundbox fleet provisioning for ${stage}`,
  stage,
  isProdLike,
  foundation,
});

// Phase 0 spike (throwaway) — only on explicit request.
if (process.env.DEPLOY_GHANA_SPIKE === 'true') {
  new GhanaPaymentsSpikeStack(app, `${prefix}-spike`, {
    env,
    stackName: `${prefix}-spike`,
    description: `Ghana Payments Phase 0 spike (throwaway) for ${stage}`,
    stage,
  });
}

cdk.Tags.of(app).add('App', 'ghana-payments');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

app.synth();
