import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class JiraDashboardStack extends cdk.Stack {
  public readonly uploadsTable: dynamodb.Table;
  public readonly issuesTable: dynamodb.Table;
  public readonly csvBucket: s3.Bucket;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') as string;
    const isProdLike = this.node.tryGetContext('isProdLike') as boolean;

    // Removal policy based on environment
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // S3 Bucket for CSV uploads
    this.csvBucket = new s3.Bucket(this, 'JiraCsvBucket', {
      bucketName: `${stage}-jira-dashboard-csvs`,
      removalPolicy,
      autoDeleteObjects: !isProdLike,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ['*'], // Should be restricted to your CloudFront domain in production
          allowedHeaders: ['*'],
        },
      ],
      ...(isProdLike && {
        lifecycleRules: [
          {
            // Archive old CSVs to Glacier after 90 days in production
            transitions: [
              {
                storageClass: s3.StorageClass.GLACIER,
                transitionAfter: cdk.Duration.days(90),
              },
            ],
          },
        ],
      }),
    });

    // DynamoDB table for upload metadata
    this.uploadsTable = new dynamodb.Table(this, 'JiraUploadsTable', {
      tableName: `${stage}-jira-uploads`,
      partitionKey: {
        name: 'uploadId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: isProdLike
        ? dynamodb.BillingMode.PROVISIONED
        : dynamodb.BillingMode.PAY_PER_REQUEST,
      readCapacity: isProdLike ? 5 : undefined,
      writeCapacity: isProdLike ? 5 : undefined,
      removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProdLike,
      },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Add GSI for querying uploads by date
    this.uploadsTable.addGlobalSecondaryIndex({
      indexName: 'TimestampIndex',
      partitionKey: {
        name: 'type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: isProdLike ? 5 : undefined,
      writeCapacity: isProdLike ? 5 : undefined,
    });

    // DynamoDB table for parsed Jira issues
    this.issuesTable = new dynamodb.Table(this, 'JiraIssuesTable', {
      tableName: `${stage}-jira-issues`,
      partitionKey: {
        name: 'issueKey',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'uploadId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: isProdLike
        ? dynamodb.BillingMode.PROVISIONED
        : dynamodb.BillingMode.PAY_PER_REQUEST,
      readCapacity: isProdLike ? 10 : undefined,
      writeCapacity: isProdLike ? 10 : undefined,
      removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProdLike,
      },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI for querying by upload
    this.issuesTable.addGlobalSecondaryIndex({
      indexName: 'UploadIndex',
      partitionKey: {
        name: 'uploadId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'created',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: isProdLike ? 10 : undefined,
      writeCapacity: isProdLike ? 10 : undefined,
    });

    // GSI for querying by status
    this.issuesTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'uploadId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: isProdLike ? 10 : undefined,
      writeCapacity: isProdLike ? 10 : undefined,
    });

    // GSI for querying by issue type
    this.issuesTable.addGlobalSecondaryIndex({
      indexName: 'IssueTypeIndex',
      partitionKey: {
        name: 'uploadId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'issueType',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: isProdLike ? 10 : undefined,
      writeCapacity: isProdLike ? 10 : undefined,
    });

    // Lambda function for CSV processing
    const csvProcessorFunction = new NodejsFunction(this, 'CsvProcessorFunction', {
      functionName: `${stage}-jira-csv-processor`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-csv-processor/index.ts'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      environment: {
        UPLOADS_TABLE: this.uploadsTable.tableName,
        ISSUES_TABLE: this.issuesTable.tableName,
        CSV_BUCKET: this.csvBucket.bucketName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'], // AWS SDK v3 is available in Lambda runtime
        format: OutputFormat.ESM,
      },
    });

    // Grant permissions
    this.csvBucket.grantRead(csvProcessorFunction);
    this.uploadsTable.grantReadWriteData(csvProcessorFunction);
    this.issuesTable.grantReadWriteData(csvProcessorFunction);

    // Lambda function for batch processing CSV rows
    const processBatchFunction = new NodejsFunction(this, 'ProcessBatchFunction', {
      functionName: `${stage}-jira-process-batch`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-process-batch/index.ts'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      environment: {
        UPLOADS_TABLE: this.uploadsTable.tableName,
        ISSUES_TABLE: this.issuesTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.csvBucket.grantRead(processBatchFunction);
    this.uploadsTable.grantReadWriteData(processBatchFunction);
    this.issuesTable.grantReadWriteData(processBatchFunction);

    // Lambda function for finalizing upload
    const finalizeUploadFunction = new NodejsFunction(this, 'FinalizeUploadFunction', {
      functionName: `${stage}-jira-finalize-upload`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-finalize-upload/index.ts'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        UPLOADS_TABLE: this.uploadsTable.tableName,
        ISSUES_TABLE: this.issuesTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.uploadsTable.grantReadWriteData(finalizeUploadFunction);
    this.issuesTable.grantReadData(finalizeUploadFunction);

    // Step Functions state machine for batch processing
    const processBatchTask = new tasks.LambdaInvoke(this, 'ProcessBatchTask', {
      lambdaFunction: processBatchFunction,
      outputPath: '$.Payload',
    });

    // Update state for next batch iteration - extracts nextStartRow and prepares for next loop
    const prepareNextBatch = new sfn.Pass(this, 'PrepareNextBatch', {
      parameters: {
        'uploadId.$': '$.uploadId',
        'timestamp.$': '$.timestamp',
        'bucket.$': '$.bucket',
        'key.$': '$.key',
        'fileName.$': '$.fileName',
        'startRow.$': '$.nextStartRow',
        'batchSize.$': '$.batchSize',
        'totalRows.$': '$.totalRows',
        'hasMore.$': '$.hasMore',
      },
    });

    const finalizeTask = new tasks.LambdaInvoke(this, 'FinalizeTask', {
      lambdaFunction: finalizeUploadFunction,
      payload: sfn.TaskInput.fromObject({
        uploadId: sfn.JsonPath.stringAt('$.uploadId'),
        timestamp: sfn.JsonPath.stringAt('$.timestamp'),
        fileName: sfn.JsonPath.stringAt('$.fileName'),
      }),
      outputPath: '$.Payload',
    });

    const choice = new sfn.Choice(this, 'HasMoreBatches?')
      .when(sfn.Condition.booleanEquals('$.hasMore', true), prepareNextBatch)
      .otherwise(finalizeTask);

    prepareNextBatch.next(processBatchTask);

    const definition = processBatchTask.next(choice);

    const stateMachine = new sfn.StateMachine(this, 'CsvProcessingStateMachine', {
      stateMachineName: `${stage}-jira-csv-processing`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(24), // Allow up to 24 hours for very large files
    });

    // Lambda function to start Step Functions execution on S3 upload
    const startProcessingFunction = new NodejsFunction(this, 'StartProcessingFunction', {
      functionName: `${stage}-jira-start-processing`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-start-processing/index.ts'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        UPLOADS_TABLE: this.uploadsTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    stateMachine.grantStartExecution(startProcessingFunction);
    this.uploadsTable.grantReadWriteData(startProcessingFunction);

    // Add S3 event notification to trigger processing on CSV upload
    this.csvBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(startProcessingFunction),
      { suffix: '.csv' }
    );

    // Lambda function for getting upload presigned URL
    const getUploadUrlFunction = new NodejsFunction(this, 'GetUploadUrlFunction', {
      functionName: `${stage}-jira-get-upload-url`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-get-upload-url/index.ts'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        CSV_BUCKET: this.csvBucket.bucketName,
        UPLOADS_TABLE: this.uploadsTable.tableName,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.csvBucket.grantPut(getUploadUrlFunction);
    this.uploadsTable.grantWriteData(getUploadUrlFunction);
    stateMachine.grantStartExecution(getUploadUrlFunction);

    // Lambda function for getting dashboard data
    const getDashboardDataFunction = new NodejsFunction(this, 'GetDashboardDataFunction', {
      functionName: `${stage}-jira-get-dashboard-data`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-get-dashboard-data/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: {
        UPLOADS_TABLE: this.uploadsTable.tableName,
        ISSUES_TABLE: this.issuesTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.uploadsTable.grantReadData(getDashboardDataFunction);
    this.issuesTable.grantReadData(getDashboardDataFunction);

    // Lambda function for getting historical data
    const getHistoricalDataFunction = new NodejsFunction(this, 'GetHistoricalDataFunction', {
      functionName: `${stage}-jira-get-historical-data`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-get-historical-data/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: {
        UPLOADS_TABLE: this.uploadsTable.tableName,
        ISSUES_TABLE: this.issuesTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.uploadsTable.grantReadData(getHistoricalDataFunction);
    this.issuesTable.grantReadData(getHistoricalDataFunction);

    // Lambda function for listing uploads
    const listUploadsFunction = new NodejsFunction(this, 'ListUploadsFunction', {
      functionName: `${stage}-jira-list-uploads`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-list-uploads/index.ts'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        UPLOADS_TABLE: this.uploadsTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.uploadsTable.grantReadData(listUploadsFunction);

    // Lambda function for deleting uploads
    const deleteUploadFunction = new NodejsFunction(this, 'DeleteUploadFunction', {
      functionName: `${stage}-jira-delete-upload`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-delete-upload/index.ts'),
      timeout: cdk.Duration.seconds(60),
      environment: {
        CSV_BUCKET: this.csvBucket.bucketName,
        UPLOADS_TABLE: this.uploadsTable.tableName,
        ISSUES_TABLE: this.issuesTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.csvBucket.grantDelete(deleteUploadFunction);
    this.csvBucket.grantRead(deleteUploadFunction);
    this.uploadsTable.grantReadWriteData(deleteUploadFunction);
    this.issuesTable.grantReadWriteData(deleteUploadFunction);

    // Lambda function for getting upload status
    const getUploadStatusFunction = new NodejsFunction(this, 'GetUploadStatusFunction', {
      functionName: `${stage}-jira-get-upload-status`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/jira-get-upload-status/index.ts'),
      timeout: cdk.Duration.seconds(10),
      environment: {
        UPLOADS_TABLE: this.uploadsTable.tableName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
    });

    this.uploadsTable.grantReadData(getUploadStatusFunction);

    // API Gateway REST API
    this.api = new apigateway.RestApi(this, 'JiraDashboardApi', {
      restApiName: `${stage}-jira-dashboard-api`,
      description: 'API for Jira Dashboard',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // Should be restricted in production
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
      deployOptions: {
        stageName: stage,
        throttlingRateLimit: isProdLike ? 1000 : 100,
        throttlingBurstLimit: isProdLike ? 2000 : 200,
      },
    });

    // API Resources
    const uploadsResource = this.api.root.addResource('uploads');
    const dashboardResource = this.api.root.addResource('dashboard');
    const historicalResource = this.api.root.addResource('historical');

    // GET /uploads - List all uploads
    uploadsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listUploadsFunction)
    );

    // POST /uploads - Get presigned URL for upload
    uploadsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(getUploadUrlFunction)
    );

    // DELETE /uploads/{uploadId} - Delete an upload
    const uploadResource = uploadsResource.addResource('{uploadId}');
    uploadResource.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(deleteUploadFunction)
    );

    // GET /uploads/{uploadId}/status - Get upload processing status
    const uploadStatusResource = uploadResource.addResource('status');
    uploadStatusResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getUploadStatusFunction)
    );

    // GET /dashboard/{uploadId} - Get dashboard data for specific upload
    const dashboardUploadResource = dashboardResource.addResource('{uploadId}');
    dashboardUploadResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getDashboardDataFunction)
    );

    // GET /historical - Get historical trend data
    historicalResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getHistoricalDataFunction)
    );

    // Lambda function for getting AWS costs
    const getCostsFunction = new NodejsFunction(this, 'GetCostsFunction', {
      functionName: `${stage}-get-costs`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../functions/src/get-costs/index.ts'),
      timeout: cdk.Duration.seconds(30),
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['ce:GetCostAndUsage'],
          resources: ['*'],
        }),
      ],
    });

    // GET /costs - Get AWS cost data
    const costsResource = this.api.root.addResource('costs');
    costsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getCostsFunction)
    );

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${stage}-jira-api-url`,
    });

    new cdk.CfnOutput(this, 'CsvBucketName', {
      value: this.csvBucket.bucketName,
      description: 'S3 Bucket for CSV uploads',
      exportName: `${stage}-jira-csv-bucket`,
    });

    new cdk.CfnOutput(this, 'UploadsTableName', {
      value: this.uploadsTable.tableName,
      description: 'DynamoDB Uploads Table',
      exportName: `${stage}-jira-uploads-table`,
    });

    new cdk.CfnOutput(this, 'IssuesTableName', {
      value: this.issuesTable.tableName,
      description: 'DynamoDB Issues Table',
      exportName: `${stage}-jira-issues-table`,
    });
  }
}
