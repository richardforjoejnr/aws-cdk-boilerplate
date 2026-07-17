import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface GhanaPaymentsSpikeStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Phase 0 spike (THROWAWAY): browser -> Cognito unauth identity -> IoT Core MQTT-WSS.
 * Validates design-review F-6 sharp edges before Phase 4 is built.
 * Deployed only with DEPLOY_GHANA_SPIKE=true; destroy after the ADR-6 decision is recorded.
 */
export class GhanaPaymentsSpikeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GhanaPaymentsSpikeStackProps) {
    super(scope, id, props);

    const { stage } = props;

    const identityPool = new cognito.CfnIdentityPool(this, 'SpikeIdentityPool', {
      identityPoolName: `${stage}_ghana_spike`,
      allowUnauthenticatedIdentities: true,
    });

    const unauthRole = new iam.Role(this, 'SpikeUnauthRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    const topicArn = `arn:aws:iot:${this.region}:${this.account}:topic/spike/*`;
    const topicFilterArn = `arn:aws:iot:${this.region}:${this.account}:topicfilter/spike/*`;
    const clientArn = `arn:aws:iot:${this.region}:${this.account}:client/spike-*`;

    unauthRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iot:Connect'],
        resources: [clientArn],
      })
    );
    unauthRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iot:Subscribe'],
        resources: [topicFilterArn],
      })
    );
    unauthRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iot:Receive', 'iot:Publish'],
        resources: [topicArn],
      })
    );

    new cognito.CfnIdentityPoolRoleAttachment(this, 'SpikeRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: { unauthenticated: unauthRole.roleArn },
    });

    // IoT policy attached per identity by the attach Lambda (the F-6 sharp edge under test).
    const iotPolicy = new iot.CfnPolicy(this, 'SpikeIotPolicy', {
      policyName: `${stage}-ghana-spike-policy`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Action: 'iot:Connect', Resource: clientArn },
          { Effect: 'Allow', Action: 'iot:Subscribe', Resource: topicFilterArn },
          { Effect: 'Allow', Action: ['iot:Receive', 'iot:Publish'], Resource: topicArn },
        ],
      },
    });

    // Stands in for the pairing Lambda: attaches the IoT policy to a Cognito identity.
    const attachFn = new lambda.Function(this, 'SpikeAttachPolicyFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      // CORS is handled entirely by the Function URL config — the Lambda must NOT
      // set Access-Control-* headers itself or browsers reject the duplicated header.
      code: lambda.Code.fromInline(`
const { IoTClient, AttachPolicyCommand } = require('@aws-sdk/client-iot');
const client = new IoTClient({});
exports.handler = async (event) => {
  try {
    const { identityId } = JSON.parse(event.body || '{}');
    if (!identityId || !/^[\\w-]+:[0-9a-f-]+$/.test(identityId)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'invalid identityId' }) };
    }
    await client.send(new AttachPolicyCommand({ policyName: process.env.POLICY_NAME, target: identityId }));
    return { statusCode: 200, body: JSON.stringify({ attached: true, identityId }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
`),
      environment: { POLICY_NAME: iotPolicy.policyName as string },
    });
    attachFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['iot:AttachPolicy'], resources: ['*'] })
    );

    const attachUrl = attachFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['content-type'],
      },
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
    new cdk.CfnOutput(this, 'IotPolicyName', { value: iotPolicy.policyName as string });
    new cdk.CfnOutput(this, 'AttachPolicyUrl', { value: attachUrl.url });
    new cdk.CfnOutput(this, 'Region', { value: this.region });
  }
}
