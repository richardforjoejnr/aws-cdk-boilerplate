import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly mainTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') as string;
    const isProdLike = this.node.tryGetContext('isProdLike') as boolean;

    // Removal policy based on environment
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Main DynamoDB table
    this.mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: `${stage}-main-table`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: isProdLike
        ? dynamodb.BillingMode.PROVISIONED
        : dynamodb.BillingMode.PAY_PER_REQUEST,
      readCapacity: isProdLike ? 5 : undefined,
      writeCapacity: isProdLike ? 5 : undefined,
      removalPolicy,
      pointInTimeRecovery: isProdLike,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: isProdLike,
    });

    // Add Global Secondary Index for querying by type
    this.mainTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'GSI1PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: isProdLike ? 5 : undefined,
      writeCapacity: isProdLike ? 5 : undefined,
    });

    // Add another GSI for different access patterns
    this.mainTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: {
        name: 'GSI2PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI2SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: isProdLike ? 5 : undefined,
      writeCapacity: isProdLike ? 5 : undefined,
    });

    // Enable auto-scaling for production
    if (isProdLike) {
      // Auto-scaling for table
      const readScaling = this.mainTable.autoScaleReadCapacity({
        minCapacity: 5,
        maxCapacity: 100,
      });

      readScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
      });

      const writeScaling = this.mainTable.autoScaleWriteCapacity({
        minCapacity: 5,
        maxCapacity: 100,
      });

      writeScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'MainTableName', {
      value: this.mainTable.tableName,
      description: 'Name of the main DynamoDB table',
      exportName: `${stage}-main-table-name`,
    });

    new cdk.CfnOutput(this, 'MainTableArn', {
      value: this.mainTable.tableArn,
      description: 'ARN of the main DynamoDB table',
      exportName: `${stage}-main-table-arn`,
    });

    new cdk.CfnOutput(this, 'MainTableStreamArn', {
      value: this.mainTable.tableStreamArn || 'N/A',
      description: 'Stream ARN of the main DynamoDB table',
      exportName: `${stage}-main-table-stream-arn`,
    });
  }
}
