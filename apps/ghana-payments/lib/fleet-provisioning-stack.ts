import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Construct } from 'constructs';
import type { GhanaPaymentsFoundationStack } from './foundation-stack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface FleetProvisioningStackProps extends cdk.StackProps {
  stage: string;
  isProdLike: boolean;
  foundation: GhanaPaymentsFoundationStack;
}

/**
 * AWS IoT Fleet Provisioning by Claim for the soundbox fleet.
 *
 * Every device ships with the SAME low-privilege "claim" certificate baked into
 * firmware. On first boot it uses the claim cert to call IoT's provisioning API,
 * a pre-provisioning hook validates the serial against the manufactured allow-list,
 * and IoT mints the device its OWN unique certificate + registers a Thing. From
 * then on the device authenticates with its own cert, scoped by a single
 * parameterised policy to `devices/<serial>/*` topics only.
 *
 * Merchant pairing is deliberately NOT part of provisioning — it's a separate
 * server-side association (POST /v1/devices/{id}/assign), so a provisioned device
 * is inert (bound to no merchant) until an operator onboards a store to it.
 *
 * Design: docs/planning/FLEET_PROVISIONING.md
 */
export class GhanaPaymentsFleetProvisioningStack extends cdk.Stack {
  public readonly devicePolicyName: string;
  public readonly claimPolicyName: string;
  public readonly templateName: string;

  constructor(scope: Construct, id: string, props: FleetProvisioningStackProps) {
    super(scope, id, props);
    const { stage, isProdLike, foundation } = props;
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.devicePolicyName = `${stage}-ghana-soundbox-device`;
    this.claimPolicyName = `${stage}-ghana-soundbox-claim`;
    this.templateName = `${stage}-ghana-soundbox`;

    // ── 1. The device (production) policy ────────────────────────────────────
    // Attached by the provisioning template to each device's OWN certificate.
    // Policy variables confine every device to topics named after ITS Thing, so
    // one policy safely serves the whole fleet (no per-device policy sprawl).
    // The Thing is named `soundbox-<serial>`; the device connects with that as
    // its MQTT client id, and publishes/subscribes only under devices/<thing>/*.
    new iot.CfnPolicy(this, 'DevicePolicy', {
      policyName: this.devicePolicyName,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `arn:aws:iot:${this.region}:${this.account}:client/\${iot:Connection.Thing.ThingName}`,
          },
          {
            Effect: 'Allow',
            Action: ['iot:Publish', 'iot:Receive'],
            Resource: `arn:aws:iot:${this.region}:${this.account}:topic/devices/\${iot:Connection.Thing.ThingName}/*`,
          },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: `arn:aws:iot:${this.region}:${this.account}:topicfilter/devices/\${iot:Connection.Thing.ThingName}/*`,
          },
        ],
      },
    });

    // ── 2. The claim (bootstrap) policy ──────────────────────────────────────
    // Attached to the shared claim certificate baked into firmware. It can do
    // ONLY the fleet-provisioning MQTT calls — never touch app topics — so a
    // leaked claim cert cannot read payments or impersonate a device.
    new iot.CfnPolicy(this, 'ClaimPolicy', {
      policyName: this.claimPolicyName,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['iot:Publish', 'iot:Receive'],
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topic/$aws/certificates/create/*`,
              `arn:aws:iot:${this.region}:${this.account}:topic/$aws/provisioning-templates/${this.templateName}/provision/*`,
            ],
          },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topicfilter/$aws/certificates/create/*`,
              `arn:aws:iot:${this.region}:${this.account}:topicfilter/$aws/provisioning-templates/${this.templateName}/provision/*`,
            ],
          },
        ],
      },
    });

    // ── 3. Pre-provisioning hook ─────────────────────────────────────────────
    // IoT calls this synchronously during provisioning. It validates the serial
    // against the manufactured allow-list (a device row in state MANUFACTURED)
    // and refuses a serial that is unknown or already provisioned — so a leaked
    // claim cert still cannot mint unlimited device identities.
    const hookLog = new logs.LogGroup(this, 'HookLogGroup', {
      logGroupName: `/aws/lambda/${stage}-ghana-fleet-preprovision`,
      retention: isProdLike ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });
    const hook = new nodejs.NodejsFunction(this, 'PreProvisionHookFn', {
      functionName: `${stage}-ghana-fleet-preprovision`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../src/fleet/pre-provisioning-hook.ts'),
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node20',
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
      environment: {
        STAGE: stage,
        DEVICES_TABLE: foundation.devicesTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logGroup: hookLog,
    });
    foundation.devicesTable.grantReadWriteData(hook);
    // IoT invokes the hook — allow it from the IoT service principal.
    hook.addPermission('AllowIotInvoke', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      sourceAccount: this.account,
    });

    // ── 4. Provisioning role ─────────────────────────────────────────────────
    // The role IoT assumes to register the Thing + activate the device cert.
    const provisioningRole = new iam.Role(this, 'ProvisioningRole', {
      roleName: `${stage}-ghana-soundbox-provisioning`,
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSIoTThingsRegistration'
        ),
      ],
    });

    // ── 5. Provisioning template ─────────────────────────────────────────────
    // Ties it together: on a valid claim, create Thing `soundbox-<serial>` (with
    // attributes), activate the device cert, and attach the fleet device policy.
    const templateBody = JSON.stringify({
      Parameters: {
        SerialNumber: { Type: 'String' },
        'AWS::IoT::Certificate::Id': { Type: 'String' },
      },
      Resources: {
        thing: {
          Type: 'AWS::IoT::Thing',
          Properties: {
            ThingName: { 'Fn::Join': ['', ['soundbox-', { Ref: 'SerialNumber' }]] },
            AttributePayload: { serial_number: { Ref: 'SerialNumber' }, fleet: 'ghana-soundbox' },
          },
          OverrideSettings: { AttributePayload: 'MERGE', ThingTypeName: 'REPLACE' },
        },
        certificate: {
          Type: 'AWS::IoT::Certificate',
          Properties: {
            CertificateId: { Ref: 'AWS::IoT::Certificate::Id' },
            Status: 'ACTIVE',
          },
        },
        policy: {
          Type: 'AWS::IoT::Policy',
          Properties: { PolicyName: this.devicePolicyName },
        },
      },
    });
    new iot.CfnProvisioningTemplate(this, 'ProvisioningTemplate', {
      templateName: this.templateName,
      description: 'Ghana soundbox fleet provisioning by claim',
      enabled: true,
      provisioningRoleArn: provisioningRole.roleArn,
      templateBody,
      preProvisioningHook: { targetArn: hook.functionArn, payloadVersion: '2020-04-01' },
    });

    new cdk.CfnOutput(this, 'ProvisioningTemplateName', {
      value: this.templateName,
      exportName: `${stage}-ghana-soundbox-template`,
    });
    new cdk.CfnOutput(this, 'ClaimPolicyName', {
      value: this.claimPolicyName,
      exportName: `${stage}-ghana-soundbox-claim-policy`,
    });
    new cdk.CfnOutput(this, 'DevicePolicyName', {
      value: this.devicePolicyName,
      exportName: `${stage}-ghana-soundbox-device-policy`,
    });
  }
}
