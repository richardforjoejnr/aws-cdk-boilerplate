import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LambdaStack extends cdk.Stack {
  public readonly helloWorldFunction: lambda.Function;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') as string;
    const isProdLike = this.node.tryGetContext('isProdLike') as boolean;

    // Determine removal policy based on environment
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Log retention based on environment
    const logRetention = isProdLike
      ? logs.RetentionDays.ONE_MONTH
      : logs.RetentionDays.ONE_WEEK;

    // Hello World Lambda Function
    this.helloWorldFunction = new nodejs.NodejsFunction(this, 'HelloWorldFunction', {
      functionName: `${stage}-hello-world`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../functions/src/hello-world/index.ts'),
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: isProdLike,
        sourceMap: !isProdLike,
        target: 'node18',
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
      environment: {
        NODE_ENV: stage,
        LOG_LEVEL: isProdLike ? 'INFO' : 'DEBUG',
        STAGE: stage,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention,
      description: 'Simple hello world Lambda function',
    });

    // Apply removal policy to log groups
    const logGroup = this.helloWorldFunction.node.findChild('LogGroup') as logs.LogGroup;
    logGroup.applyRemovalPolicy(removalPolicy);

    // Output the function ARN
    new cdk.CfnOutput(this, 'HelloWorldFunctionArn', {
      value: this.helloWorldFunction.functionArn,
      description: 'ARN of the Hello World Lambda function',
      exportName: `${stage}-hello-world-function-arn`,
    });

    new cdk.CfnOutput(this, 'HelloWorldFunctionName', {
      value: this.helloWorldFunction.functionName,
      description: 'Name of the Hello World Lambda function',
      exportName: `${stage}-hello-world-function-name`,
    });
  }
}
