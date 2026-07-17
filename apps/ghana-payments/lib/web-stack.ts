import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GhanaPaymentsApiStack } from './api-stack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GhanaPaymentsWebStackProps extends cdk.StackProps {
  stage: string;
  isProdLike: boolean;
  apiStack: GhanaPaymentsApiStack;
}

/**
 * Phase 3 — one public domain (design-review F-4): CloudFront serves the portals from
 * S3 and routes /api/* to API Gateway (no CORS, one URL). Publishes the CloudFront URL
 * to SSM as public-base-url so the QR service builds scannable payload URLs (D3).
 */
export class GhanaPaymentsWebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GhanaPaymentsWebStackProps) {
    super(scope, id, props);

    const { stage, isProdLike, apiStack } = props;
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    const siteBucket = new s3.Bucket(this, 'PortalBucket', {
      bucketName: `${stage}-ghana-portals-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !isProdLike,
    });

    // Pretty URLs: /pay/{qr_id} and /admin resolve to their index.html
    const staticRewrite = new cloudfront.Function(this, 'StaticRewriteFn', {
      functionName: `${stage}-ghana-static-rewrite`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.startsWith('/pay/')) { req.uri = '/pay/index.html'; }
  else if (uri.endsWith('/')) { req.uri = uri + 'index.html'; }
  else if (!uri.includes('.')) { req.uri = uri + '/index.html'; }
  return req;
}`),
    });

    // /api/v1/... -> /v1/... before it reaches the API Gateway origin (originPath adds /{stage})
    const apiRewrite = new cloudfront.Function(this, 'ApiRewriteFn', {
      functionName: `${stage}-ghana-api-rewrite`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  req.uri = req.uri.replace(/^\\/api/, '');
  return req;
}`),
    });

    const distribution = new cloudfront.Distribution(this, 'PortalDistribution', {
      comment: `${stage} ghana-payments portals + API`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: staticRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.RestApiOrigin(apiStack.api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            { function: apiRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          ],
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'PortalDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../web'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // QR payload URLs are built from this at runtime (config cache 60s)
    new ssm.StringParameter(this, 'PublicBaseUrlParam', {
      parameterName: `/${stage}/ghana-payments/public-base-url`,
      stringValue: `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, 'PortalUrl', {
      value: `https://${distribution.distributionDomainName}`,
      exportName: `${stage}-ghana-payments-portal-url`,
    });
  }
}
