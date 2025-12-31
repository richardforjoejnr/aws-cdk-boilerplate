import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for pipeline artifacts
    const artifactBucket = new s3.Bucket(this, 'PipelineArtifactBucket', {
      bucketName: `aws-boilerplate-pipeline-artifacts-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          id: 'DeleteOldArtifacts',
        },
      ],
    });

    // Source output artifact
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    // GitHub source action (requires GitHub connection)
    // Note: You'll need to create a GitHub connection in AWS Console first
    const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: 'GitHub_Source',
      owner: 'YOUR_GITHUB_USERNAME', // TODO: Replace with your GitHub username
      repo: 'aws-lambda-stepfunctions-boilerplate', // TODO: Replace with your repo name
      branch: 'main',
      connectionArn: 'arn:aws:codestar-connections:REGION:ACCOUNT:connection/CONNECTION_ID', // TODO: Replace with your connection ARN
      output: sourceOutput,
    });

    // Build project for dev environment
    const devBuildProject = new codebuild.PipelineProject(this, 'DevBuildProject', {
      projectName: 'aws-boilerplate-dev-build',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      environmentVariables: {
        STAGE: { value: 'dev' },
        NODE_ENV: { value: 'development' },
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('ci/buildspec.yml'),
    });

    // Build project for test environment
    const testBuildProject = new codebuild.PipelineProject(this, 'TestBuildProject', {
      projectName: 'aws-boilerplate-test-build',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      environmentVariables: {
        STAGE: { value: 'test' },
        NODE_ENV: { value: 'test' },
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('ci/buildspec.yml'),
    });

    // Build project for prod environment
    const prodBuildProject = new codebuild.PipelineProject(this, 'ProdBuildProject', {
      projectName: 'aws-boilerplate-prod-build',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      environmentVariables: {
        STAGE: { value: 'prod' },
        NODE_ENV: { value: 'production' },
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('ci/buildspec.yml'),
    });

    // Grant CDK deployment permissions to build projects
    const cdkDeployPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:*',
        'lambda:*',
        'states:*',
        'logs:*',
        'iam:*',
        's3:*',
        'ecr:*',
        'ce:*', // Cost Explorer permissions for cost tracking Lambda
      ],
      resources: ['*'],
    });

    devBuildProject.addToRolePolicy(cdkDeployPolicy);
    testBuildProject.addToRolePolicy(cdkDeployPolicy);
    prodBuildProject.addToRolePolicy(cdkDeployPolicy);

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'aws-boilerplate-pipeline',
      artifactBucket,
      restartExecutionOnUpdate: true,
    });

    // Source stage
    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Dev deployment stage
    pipeline.addStage({
      stageName: 'Deploy_Dev',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Deploy_to_Dev',
          project: devBuildProject,
          input: sourceOutput,
        }),
      ],
    });

    // Test deployment stage (with manual approval)
    pipeline.addStage({
      stageName: 'Deploy_Test',
      actions: [
        new codepipeline_actions.ManualApprovalAction({
          actionName: 'Approve_Test_Deployment',
          additionalInformation: 'Please review and approve deployment to test environment',
        }),
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Deploy_to_Test',
          project: testBuildProject,
          input: sourceOutput,
          runOrder: 2,
        }),
      ],
    });

    // Prod deployment stage (with manual approval)
    pipeline.addStage({
      stageName: 'Deploy_Prod',
      actions: [
        new codepipeline_actions.ManualApprovalAction({
          actionName: 'Approve_Prod_Deployment',
          additionalInformation: 'Please review and approve deployment to production environment',
        }),
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Deploy_to_Prod',
          project: prodBuildProject,
          input: sourceOutput,
          runOrder: 2,
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'PipelineArn', {
      value: pipeline.pipelineArn,
      description: 'ARN of the CI/CD pipeline',
    });

    new cdk.CfnOutput(this, 'ArtifactBucketName', {
      value: artifactBucket.bucketName,
      description: 'S3 bucket for pipeline artifacts',
    });
  }
}
