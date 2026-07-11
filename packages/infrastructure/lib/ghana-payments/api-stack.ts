import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GhanaPaymentsFoundationStack } from './foundation-stack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GhanaPaymentsApiStackProps extends cdk.StackProps {
  stage: string;
  isProdLike: boolean;
  foundation: GhanaPaymentsFoundationStack;
}

/**
 * Phase 2 — payment core: REST API (§8.1/§8.3 + Wallet API), mock provider callback
 * queue, idempotent webhook receiver, sweeper, credit-back and audit bus subscribers.
 * Design: packages/ghana-payments/docs/planning/architecture.md
 */
export class GhanaPaymentsApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: GhanaPaymentsApiStackProps) {
    super(scope, id, props);

    const { stage, isProdLike, foundation } = props;
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const logRetention = isProdLike ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK;
    const srcRoot = path.join(__dirname, '../../../ghana-payments/src');

    // Mock provider callback delay queue + DLQ (design-review F-2)
    const callbackDlq = new sqs.Queue(this, 'MockCallbackDlq', {
      queueName: `${stage}-ghana-mock-callbacks-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });
    const callbackQueue = new sqs.Queue(this, 'MockCallbackQueue', {
      queueName: `${stage}-ghana-mock-callbacks`,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: { queue: callbackDlq, maxReceiveCount: 3 },
    });

    const commonEnv = {
      STAGE: stage,
      PAYMENTS_TABLE: foundation.paymentsTable.tableName,
      MERCHANTS_TABLE: foundation.merchantsTable.tableName,
      QR_CODES_TABLE: foundation.qrCodesTable.tableName,
      WALLETS_TABLE: foundation.walletsTable.tableName,
      AUDIT_TABLE: foundation.auditTable.tableName,
      DEVICES_TABLE: foundation.devicesTable.tableName,
      ACCOUNT_ID: this.account,
      EVENT_BUS_NAME: foundation.eventBus.eventBusName,
      WEBHOOK_INBOX_BUCKET: foundation.webhookInbox.bucketName,
      MOCK_CALLBACK_QUEUE_URL: callbackQueue.queueUrl,
    };

    const make = (name: string, entry: string, handler = 'handler'): nodejs.NodejsFunction => {
      const logGroup = new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/${stage}-ghana-${name}`,
        retention: logRetention,
        removalPolicy,
      });
      const fn = new nodejs.NodejsFunction(this, `${name}Fn`, {
        functionName: `${stage}-ghana-${name}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler,
        entry: path.join(srcRoot, entry),
        bundling: {
          format: nodejs.OutputFormat.ESM,
          minify: isProdLike,
          sourceMap: !isProdLike,
          target: 'node20',
          mainFields: ['module', 'main'],
          banner:
            "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        },
        environment: commonEnv,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        logGroup,
      });
      // Config params (ADR-7 magic amounts etc.)
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ssm:GetParametersByPath'],
          resources: [
            `arn:aws:ssm:${this.region}:${this.account}:parameter/${stage}/ghana-payments/*`,
            `arn:aws:ssm:${this.region}:${this.account}:parameter/${stage}/ghana-payments`,
          ],
        })
      );
      return fn;
    };

    // --- Lambdas (least-privilege grants per function) ---
    const merchantCreate = make('merchant-create', 'merchants/handlers.ts', 'createHandler');
    const merchantList = make('merchant-list', 'merchants/handlers.ts', 'listHandler');
    const merchantGet = make('merchant-get', 'merchants/handlers.ts', 'getHandler');
    const merchantStatus = make('merchant-status', 'merchants/handlers.ts', 'statusHandler');
    const merchantDelete = make('merchant-delete', 'merchants/handlers.ts', 'deleteHandler');
    for (const fn of [merchantCreate, merchantList, merchantGet, merchantStatus, merchantDelete]) {
      foundation.merchantsTable.grantReadWriteData(fn);
    }
    foundation.qrCodesTable.grantReadWriteData(merchantDelete); // deactivates the merchant's QRs

    const qrGenerate = make('qr-generate', 'qr/handlers.ts', 'generateHandler');
    const qrGet = make('qr-get', 'qr/handlers.ts', 'getHandler');
    const qrResolve = make('qr-resolve', 'qr/handlers.ts', 'resolveHandler');
    const qrRotate = make('qr-rotate', 'qr/handlers.ts', 'rotateHandler');
    const qrStatus = make('qr-status', 'qr/handlers.ts', 'statusHandler');
    for (const fn of [qrGenerate, qrGet, qrResolve, qrRotate, qrStatus]) {
      foundation.qrCodesTable.grantReadWriteData(fn);
      foundation.merchantsTable.grantReadData(fn);
    }

    const walletTopup = make('wallet-topup', 'wallets/handlers.ts', 'topupHandler');
    const walletGet = make('wallet-get', 'wallets/handlers.ts', 'getHandler');
    foundation.walletsTable.grantReadWriteData(walletTopup);
    foundation.walletsTable.grantReadData(walletGet);

    const paymentInitiate = make('payment-initiate', 'payments/initiate.ts');
    foundation.paymentsTable.grantReadWriteData(paymentInitiate);
    foundation.walletsTable.grantReadWriteData(paymentInitiate);
    foundation.merchantsTable.grantReadData(paymentInitiate);
    foundation.eventBus.grantPutEventsTo(paymentInitiate);
    callbackQueue.grantSendMessages(paymentInitiate);

    const paymentGet = make('payment-get', 'payments/get.ts');
    foundation.paymentsTable.grantReadData(paymentGet);

    const webhook = make('webhook-receiver', 'payments/webhook.ts');
    foundation.paymentsTable.grantReadWriteData(webhook);
    foundation.webhookInbox.grantPut(webhook);
    foundation.eventBus.grantPutEventsTo(webhook);

    const mockDelivery = make('mock-delivery', 'payments/mock-delivery.ts');
    mockDelivery.addEventSource(
      new eventsources.SqsEventSource(callbackQueue, { batchSize: 5 })
    );

    const sweeper = make('sweeper', 'payments/sweeper.ts');
    foundation.paymentsTable.grantReadWriteData(sweeper);
    foundation.eventBus.grantPutEventsTo(sweeper);
    new events.Rule(this, 'SweeperSchedule', {
      ruleName: `${stage}-ghana-sweeper`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(sweeper)],
    });

    const creditBack = make('credit-back', 'events/credit-back.ts');
    foundation.paymentsTable.grantReadWriteData(creditBack);
    foundation.walletsTable.grantReadWriteData(creditBack);
    foundation.eventBus.grantPutEventsTo(creditBack);
    const creditBackDlq = new sqs.Queue(this, 'CreditBackDlq', {
      queueName: `${stage}-ghana-credit-back-dlq`,
    });
    new events.Rule(this, 'CreditBackRule', {
      ruleName: `${stage}-ghana-credit-back`,
      eventBus: foundation.eventBus,
      eventPattern: {
        source: ['ghana.payments'],
        detailType: ['payment.failed', 'payment.expired'],
      },
      targets: [
        new targets.LambdaFunction(creditBack, {
          deadLetterQueue: creditBackDlq,
          retryAttempts: 3,
        }),
      ],
    });

    const auditWriter = make('audit-writer', 'events/audit-writer.ts');
    foundation.auditTable.grantWriteData(auditWriter);
    const auditDlq = new sqs.Queue(this, 'AuditDlq', { queueName: `${stage}-ghana-audit-dlq` });
    new events.Rule(this, 'AuditRule', {
      ruleName: `${stage}-ghana-audit-all`,
      eventBus: foundation.eventBus,
      eventPattern: { source: ['ghana.payments'] },
      targets: [
        new targets.LambdaFunction(auditWriter, { deadLetterQueue: auditDlq, retryAttempts: 3 }),
      ],
    });

    // --- REST API (§8, ADR-10). CORS wide-open for the PoC until CloudFront single-domain (F-4) lands in Phase 3. ---
    this.api = new apigateway.RestApi(this, 'GhanaPaymentsApi', {
      restApiName: `${stage}-ghana-payments-api`,
      deployOptions: {
        stageName: stage,
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Api-Key'],
      },
    });

    const v1 = this.api.root.addResource('v1');
    const integrate = (fn: lambda.IFunction): apigateway.LambdaIntegration =>
      new apigateway.LambdaIntegration(fn);
    const adminOpts: apigateway.MethodOptions = { apiKeyRequired: true };

    // Merchant API (admin, API key — F-5 accepted risk)
    const merchants = v1.addResource('merchants');
    merchants.addMethod('POST', integrate(merchantCreate), adminOpts);
    merchants.addMethod('GET', integrate(merchantList), adminOpts);
    const merchantById = merchants.addResource('{id}');
    merchantById.addMethod('GET', integrate(merchantGet), adminOpts);
    merchantById.addMethod('DELETE', integrate(merchantDelete), adminOpts);
    merchantById.addResource('status').addMethod('PATCH', integrate(merchantStatus), adminOpts);
    merchantById.addResource('qrs').addMethod('POST', integrate(qrGenerate), adminOpts);

    // QR API (§8.2) — resolve is public (scanned by any phone), the rest admin
    const qrs = v1.addResource('qrs');
    const qrById = qrs.addResource('{qr_id}');
    qrById.addMethod('GET', integrate(qrGet), adminOpts);
    qrById.addResource('resolve').addMethod('GET', integrate(qrResolve));
    qrById.addResource('rotate').addMethod('POST', integrate(qrRotate), adminOpts);
    qrById.addResource('status').addMethod('PATCH', integrate(qrStatus), adminOpts);

    // Wallet API (public simulation, D7)
    const wallets = v1.addResource('wallets');
    const walletByPhone = wallets.addResource('{phone}');
    walletByPhone.addMethod('GET', integrate(walletGet));
    walletByPhone.addResource('topup').addMethod('POST', integrate(walletTopup));

    // Payment API (public — portal-driven)
    const payments = v1.addResource('payments');
    payments.addMethod('POST', integrate(paymentInitiate));
    payments.addResource('{id}').addMethod('GET', integrate(paymentGet));

    // Webhook receiver (public; idempotency is the retained control — ADR-8)
    v1.addResource('webhooks').addResource('{provider}').addMethod('POST', integrate(webhook));

    const authToken = make('auth-token', 'auth/handlers.ts', 'tokenHandler');
    v1.addResource('auth').addResource('token').addMethod('POST', integrate(authToken));

    // --- Devices + soundbox (Phase 4) ---

    // Cognito identity pool for soundbox devices (spike-proven, ADR-6). The unauth IAM
    // role is broad within devices/*; the per-device IoT policy attached at pairing
    // narrows it to that device's topics — broker-enforced identity.
    const identityPool = new cognito.CfnIdentityPool(this, 'SoundboxIdentityPool', {
      identityPoolName: `${stage}_ghana_soundbox`,
      allowUnauthenticatedIdentities: true,
    });
    const soundboxRole = new iam.Role(this, 'SoundboxUnauthRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });
    soundboxRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iot:Connect'],
        resources: [`arn:aws:iot:${this.region}:${this.account}:client/soundbox-*`],
      })
    );
    soundboxRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iot:Subscribe'],
        resources: [`arn:aws:iot:${this.region}:${this.account}:topicfilter/devices/*`],
      })
    );
    soundboxRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iot:Receive', 'iot:Publish'],
        resources: [`arn:aws:iot:${this.region}:${this.account}:topic/devices/*`],
      })
    );
    new cognito.CfnIdentityPoolRoleAttachment(this, 'SoundboxRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: { unauthenticated: soundboxRole.roleArn },
    });

    const iotPublish = new iam.PolicyStatement({
      actions: ['iot:Publish'],
      resources: [`arn:aws:iot:${this.region}:${this.account}:topic/devices/*`],
    });
    const iotDescribe = new iam.PolicyStatement({
      actions: ['iot:DescribeEndpoint'],
      resources: ['*'],
    });

    const deviceRegister = make('device-register', 'devices/handlers.ts', 'registerHandler');
    const deviceList = make('device-list', 'devices/handlers.ts', 'listHandler');
    const devicePairingCode = make('device-pairing-code', 'devices/handlers.ts', 'pairingCodeHandler');
    const devicePair = make('device-pair', 'devices/handlers.ts', 'pairHandler');
    const deviceCommand = make('device-command', 'devices/handlers.ts', 'commandHandler');
    const deviceStatus = make('device-status', 'devices/handlers.ts', 'statusHandler');
    const deviceDelete = make('device-delete', 'devices/handlers.ts', 'deleteHandler');
    const soundboxConfig = make('soundbox-config', 'devices/handlers.ts', 'configHandler');
    for (const fn of [deviceRegister, deviceList, devicePairingCode, devicePair, deviceCommand, deviceStatus, deviceDelete]) {
      foundation.devicesTable.grantReadWriteData(fn);
    }
    deviceDelete.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iot:ListTargetsForPolicy', 'iot:DetachPolicy', 'iot:DeletePolicy'],
        resources: ['*'],
      })
    );
    foundation.merchantsTable.grantReadData(devicePairingCode);
    foundation.merchantsTable.grantReadData(devicePair); // pair response includes merchant_name
    devicePair.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['iot:CreatePolicy', 'iot:AttachPolicy'], resources: ['*'] })
    );
    devicePair.addToRolePolicy(iotDescribe);
    deviceCommand.addToRolePolicy(iotPublish);
    deviceCommand.addToRolePolicy(iotDescribe);
    soundboxConfig.addToRolePolicy(iotDescribe);
    soundboxConfig.addEnvironment('IDENTITY_POOL_ID', identityPool.ref);

    // Device API routes (§8.4): pair + config are public (device-called), the rest admin
    const devices = v1.addResource('devices');
    devices.addMethod('POST', integrate(deviceRegister), adminOpts);
    devices.addMethod('GET', integrate(deviceList), adminOpts);
    devices.addResource('pair').addMethod('POST', integrate(devicePair));
    const deviceById = devices.addResource('{id}');
    deviceById.addMethod('DELETE', integrate(deviceDelete), adminOpts);
    deviceById.addResource('pairing-code').addMethod('POST', integrate(devicePairingCode), adminOpts);
    deviceById.addResource('events').addMethod('POST', integrate(deviceCommand), adminOpts);
    deviceById.addResource('status').addMethod('PATCH', integrate(deviceStatus), adminOpts);
    v1.addResource('soundbox').addResource('config').addMethod('GET', integrate(soundboxConfig));

    // Announcer: payment.confirmed -> announce-once guard -> per-device MQTT publish
    const announcer = make('device-announcer', 'devices/announcer.ts');
    foundation.devicesTable.grantReadData(announcer);
    foundation.paymentsTable.grantReadWriteData(announcer);
    announcer.addToRolePolicy(iotPublish);
    announcer.addToRolePolicy(iotDescribe);
    const announcerDlq = new sqs.Queue(this, 'AnnouncerDlq', {
      queueName: `${stage}-ghana-announcer-dlq`,
    });
    new events.Rule(this, 'AnnouncerRule', {
      ruleName: `${stage}-ghana-announcer`,
      eventBus: foundation.eventBus,
      eventPattern: { source: ['ghana.payments'], detailType: ['payment.confirmed'] },
      targets: [
        new targets.LambdaFunction(announcer, { deadLetterQueue: announcerDlq, retryAttempts: 3 }),
      ],
    });

    // Issue reporting: portals -> GitHub Issues (token in SSM SecureString, out-of-band)
    const issues = make('issues', 'issues/handlers.ts', 'createHandler');
    issues.addEnvironment('GITHUB_REPO', 'richardforjoejnr/aws-cdk-boilerplate');
    issues.addEnvironment('GITHUB_TOKEN_PARAM', `/${stage}/ghana-payments/github/token`);
    issues.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${stage}/ghana-payments/github/token`,
        ],
      })
    );
    v1.addResource('issues').addMethod('POST', integrate(issues), adminOpts);

    // Cost footer: account MTD spend, SSM-cached 6h (each CE call bills $0.01)
    const costs = make('costs', 'costs/handlers.ts');
    costs.addEnvironment('COST_CACHE_PARAM', `/${stage}/ghana-payments/cost-cache`);
    costs.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ce:GetCostAndUsage'], resources: ['*'] })
    );
    costs.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${stage}/ghana-payments/cost-cache`,
        ],
      })
    );
    v1.addResource('costs').addMethod('GET', integrate(costs), adminOpts);

    // Heartbeats: devices/+/heartbeat -> device status/last-seen
    const statusUpdater = make('device-status-updater', 'devices/status-updater.ts');
    foundation.devicesTable.grantReadWriteData(statusUpdater);
    const heartbeatRule = new iot.CfnTopicRule(this, 'HeartbeatRule', {
      ruleName: `${stage.replace(/-/g, '_')}_ghana_heartbeat`,
      topicRulePayload: {
        sql: "SELECT *, topic(2) as device_id FROM 'devices/+/heartbeat'",
        awsIotSqlVersion: '2016-03-23',
        actions: [{ lambda: { functionArn: statusUpdater.functionArn } }],
      },
    });
    statusUpdater.addPermission('IotInvoke', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      sourceArn: heartbeatRule.attrArn,
    });

    // API key + usage plan for the admin surface
    const apiKey = this.api.addApiKey('AdminApiKey', { apiKeyName: `${stage}-ghana-admin-key` });
    const plan = this.api.addUsagePlan('AdminUsagePlan', {
      name: `${stage}-ghana-admin`,
      throttle: { rateLimit: 20, burstLimit: 40 },
    });
    plan.addApiKey(apiKey);
    plan.addApiStage({ stage: this.api.deploymentStage });

    // Key referenced by NAME, not keyId — an env ref to the key resource would create a
    // circular dependency (key -> usage-plan stage -> deployment -> auth method -> lambda).
    authToken.addEnvironment('ADMIN_API_KEY_NAME', `${stage}-ghana-admin-key`);
    authToken.addEnvironment('ADMIN_CREDS_PARAM', `/${stage}/ghana-payments/admin/credentials`);
    authToken.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${stage}/ghana-payments/admin/credentials`,
        ],
      })
    );
    authToken.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['apigateway:GET'],
        resources: [`arn:aws:apigateway:${this.region}::/apikeys`],
      })
    );

    // Mock delivery posts to the REAL public webhook URL (F-2). Built from restApiId to
    // avoid a resource cycle with the deployment stage.
    mockDelivery.addEnvironment(
      'WEBHOOK_URL',
      `https://${this.api.restApiId}.execute-api.${this.region}.amazonaws.com/${stage}/v1/webhooks/mock`
    );

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: `${stage}-ghana-payments-api-url`,
    });
    new cdk.CfnOutput(this, 'AdminApiKeyId', {
      value: apiKey.keyId,
      description: 'Fetch value: aws apigateway get-api-key --api-key <id> --include-value',
    });
  }
}
