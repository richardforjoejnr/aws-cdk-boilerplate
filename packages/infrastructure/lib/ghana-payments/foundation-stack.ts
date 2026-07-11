import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface GhanaPaymentsFoundationStackProps extends cdk.StackProps {
  stage: string;
  isProdLike: boolean;
}

/**
 * Ghana Payments PoC — foundation (Phase 1 of the roadmap).
 * Data layer (DynamoDB tables, S3 webhook inbox), event layer (EventBridge bus),
 * and mock-provider configuration (SSM). API/IoT/portal stacks build on these.
 * Design: packages/ghana-payments/docs/planning/architecture.md
 */
export class GhanaPaymentsFoundationStack extends cdk.Stack {
  public readonly merchantsTable: dynamodb.Table;
  public readonly walletsTable: dynamodb.Table;
  public readonly qrCodesTable: dynamodb.Table;
  public readonly paymentsTable: dynamodb.Table;
  public readonly devicesTable: dynamodb.Table;
  public readonly settlementsTable: dynamodb.Table;
  public readonly auditTable: dynamodb.Table;
  public readonly eventBus: events.EventBus;
  public readonly webhookInbox: s3.Bucket;

  constructor(scope: Construct, id: string, props: GhanaPaymentsFoundationStackProps) {
    super(scope, id, props);

    const { stage, isProdLike } = props;
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    const tableDefaults = {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProdLike },
      deletionProtection: isProdLike,
    } as const;

    this.merchantsTable = new dynamodb.Table(this, 'MerchantsTable', {
      ...tableDefaults,
      tableName: `${stage}-ghana-merchants`,
      partitionKey: { name: 'merchant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    });

    this.walletsTable = new dynamodb.Table(this, 'WalletsTable', {
      ...tableDefaults,
      tableName: `${stage}-ghana-wallets`,
      partitionKey: { name: 'phone', type: dynamodb.AttributeType.STRING },
    });

    this.qrCodesTable = new dynamodb.Table(this, 'QrCodesTable', {
      ...tableDefaults,
      tableName: `${stage}-ghana-qr-codes`,
      partitionKey: { name: 'qr_id', type: dynamodb.AttributeType.STRING },
    });
    this.qrCodesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'merchant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Ledger: META (mutable status), EVT# (append-only history), IDEMPOTENCY# (unique guard)
    this.paymentsTable = new dynamodb.Table(this, 'PaymentsTable', {
      ...tableDefaults,
      tableName: `${stage}-ghana-payments`,
      partitionKey: { name: 'payment_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    });
    this.paymentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'merchant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'confirmed_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.paymentsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.devicesTable = new dynamodb.Table(this, 'DevicesTable', {
      ...tableDefaults,
      tableName: `${stage}-ghana-devices`,
      partitionKey: { name: 'device_id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'pairing_code_expires_at',
    });
    this.devicesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'merchant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'paired_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.settlementsTable = new dynamodb.Table(this, 'SettlementsTable', {
      ...tableDefaults,
      tableName: `${stage}-ghana-settlements`,
      partitionKey: { name: 'merchant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
    });

    this.auditTable = new dynamodb.Table(this, 'AuditTable', {
      ...tableDefaults,
      tableName: `${stage}-ghana-audit`,
      partitionKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });

    this.eventBus = new events.EventBus(this, 'PaymentEventBus', {
      eventBusName: `${stage}-ghana-payments`,
    });

    // Raw provider callbacks land here before any processing (concept Appendix B)
    this.webhookInbox = new s3.Bucket(this, 'WebhookInbox', {
      bucketName: `${stage}-ghana-webhook-inbox-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !isProdLike,
      lifecycleRules: isProdLike ? [] : [{ expiration: cdk.Duration.days(30) }],
    });

    // Mock provider outcome amounts (pesewas) — ADR-7
    const mockConfig: Record<string, string> = {
      'mock/fail-amount-pesewas': '1300',
      'mock/timeout-amount-pesewas': '999',
      'mock/duplicate-amount-pesewas': '222',
      'mock/callback-delay-seconds': '3',
      'sweeper/expiry-minutes': '5',
      'provider/active': 'mock',
    };
    for (const [key, value] of Object.entries(mockConfig)) {
      new ssm.StringParameter(this, `Param-${key.replace(/\//g, '-')}`, {
        parameterName: `/${stage}/ghana-payments/${key}`,
        stringValue: value,
      });
    }

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      exportName: `${stage}-ghana-payments-event-bus`,
    });
    new cdk.CfnOutput(this, 'WebhookInboxBucket', {
      value: this.webhookInbox.bucketName,
      exportName: `${stage}-ghana-payments-webhook-inbox`,
    });
    new cdk.CfnOutput(this, 'PaymentsTableName', {
      value: this.paymentsTable.tableName,
      exportName: `${stage}-ghana-payments-table`,
    });
  }
}
