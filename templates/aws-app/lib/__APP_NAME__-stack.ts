import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface __APP_PASCAL__StackProps extends cdk.StackProps {
  stage: string;
  isProd: boolean;
}

/**
 * __APP_TITLE__ — a minimal, deployable serverless API:
 *   API Gateway (REST) -> Lambda (Node 20, ESM) -> DynamoDB (single table).
 * Non-prod tears down cleanly (DESTROY removal policy); prod retains data.
 */
export class __APP_PASCAL__Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: __APP_PASCAL__StackProps) {
    super(scope, id, props);
    const { stage, isProd } = props;
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    const table = new dynamodb.Table(this, 'Table', {
      tableName: `${stage}-__APP_NAME__`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      deletionProtection: isProd,
    });

    const logGroup = new logs.LogGroup(this, 'ApiFnLogs', {
      logGroupName: `/aws/lambda/${stage}-__APP_NAME__-api`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });

    const apiFn = new nodejs.NodejsFunction(this, 'ApiFn', {
      functionName: `${stage}-__APP_NAME__-api`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../src/handler/index.ts'),
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: isProd,
        sourceMap: !isProd,
        target: 'node20',
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
      environment: { TABLE_NAME: table.tableName, STAGE: stage },
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      logGroup,
    });
    table.grantReadWriteData(apiFn);

    const api = new apigateway.LambdaRestApi(this, 'Api', {
      restApiName: `${stage}-__APP_NAME__`,
      handler: apiFn,
      deployOptions: { stageName: stage, throttlingRateLimit: 50, throttlingBurstLimit: 100 },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      exportName: `${stage}-__APP_NAME__-api-url`,
    });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
