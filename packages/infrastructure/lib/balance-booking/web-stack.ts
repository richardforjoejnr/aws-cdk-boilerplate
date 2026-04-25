import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BalanceBookingWebStackProps extends cdk.StackProps {
  stage: string;
  isProdLike: boolean;
}

export class BalanceBookingWebStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BalanceBookingWebStackProps) {
    super(scope, id, props);

    const { stage, isProdLike } = props;

    this.bucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `${stage}-balance-booking-web`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProdLike,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Origin Access Control (OAC) — replaces the deprecated Origin Access Identity (OAI).
    // withOriginAccessControl() creates the OAC, attaches it to the origin, and writes the
    // bucket policy that grants the distribution scoped read access via the OAC.
    this.distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      defaultRootObject: 'index.html',
      comment: `${stage} Balance Booking Web Distribution`,
      priceClass: isProdLike
        ? cloudfront.PriceClass.PRICE_CLASS_ALL
        : cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const distPath = path.join(__dirname, '../../../balance-booking-web/dist');
    if (fs.existsSync(distPath)) {
      new s3deploy.BucketDeployment(this, 'DeployWeb', {
        sources: [s3deploy.Source.asset(distPath)],
        destinationBucket: this.bucket,
        distribution: this.distribution,
        distributionPaths: ['/*'],
      });
    }

    new cdk.CfnOutput(this, 'WebUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: `${stage}-balance-booking-web-url`,
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: `${stage}-balance-booking-distribution-id`,
    });
    new cdk.CfnOutput(this, 'WebBucketName', {
      value: this.bucket.bucketName,
      exportName: `${stage}-balance-booking-web-bucket`,
    });
  }
}
