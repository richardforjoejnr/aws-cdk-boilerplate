import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface StepFunctionsStackProps extends cdk.StackProps {
  helloWorldFunction: lambda.Function;
}

export class StepFunctionsStack extends cdk.Stack {
  public readonly helloWorldStateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: StepFunctionsStackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') as string;
    const isProdLike = this.node.tryGetContext('isProdLike') as boolean;

    // Removal policy based on environment
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Log retention based on environment
    const logRetention = isProdLike
      ? logs.RetentionDays.ONE_MONTH
      : logs.RetentionDays.ONE_WEEK;

    // Create CloudWatch Log Group for Step Functions
    const logGroup = new logs.LogGroup(this, 'StateMachineLogGroup', {
      logGroupName: `/aws/stepfunctions/${stage}-hello-world-state-machine`,
      retention: logRetention,
      removalPolicy,
    });

    // Define the Lambda task
    const invokeLambda = new tasks.LambdaInvoke(this, 'InvokeHelloWorld', {
      lambdaFunction: props.helloWorldFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Define success state
    const success = new sfn.Succeed(this, 'Success', {
      comment: 'Execution completed successfully',
    });

    // Define failure state
    const failure = new sfn.Fail(this, 'Failure', {
      comment: 'Execution failed',
      error: 'ExecutionFailed',
      cause: 'Lambda function returned an error',
    });

    // Define the state machine definition
    const definition = invokeLambda
      .addRetry({
        errors: ['States.TaskFailed', 'States.Timeout'],
        interval: cdk.Duration.seconds(2),
        maxAttempts: 3,
        backoffRate: 2,
      })
      .addCatch(failure, {
        errors: ['States.ALL'],
        resultPath: '$.error',
      })
      .next(success);

    // Create the state machine
    this.helloWorldStateMachine = new sfn.StateMachine(this, 'HelloWorldStateMachine', {
      stateMachineName: `${stage}-hello-world-state-machine`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(5),
      logs: {
        destination: logGroup,
        level: isProdLike ? sfn.LogLevel.ERROR : sfn.LogLevel.ALL,
        includeExecutionData: !isProdLike,
      },
      tracingEnabled: isProdLike,
    });

    // Outputs
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.helloWorldStateMachine.stateMachineArn,
      description: 'ARN of the Hello World State Machine',
      exportName: `${stage}-hello-world-state-machine-arn`,
    });

    new cdk.CfnOutput(this, 'StateMachineName', {
      value: this.helloWorldStateMachine.stateMachineName,
      description: 'Name of the Hello World State Machine',
      exportName: `${stage}-hello-world-state-machine-name`,
    });
  }
}
