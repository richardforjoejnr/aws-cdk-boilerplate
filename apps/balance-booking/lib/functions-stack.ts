import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BalanceBookingFunctionsStackProps extends cdk.StackProps {
  stage: string;
  isProdLike: boolean;
  bookingTable: dynamodb.Table;
}

export interface BookingFunctions {
  listClasses: lambda.Function;
  myProfile: lambda.Function;
  myBookings: lambda.Function;
  submitParq: lambda.Function;
  bookBasket: lambda.Function;
  cancelBooking: lambda.Function;
  adminCreateClass: lambda.Function;
  adminUpdateClass: lambda.Function;
  adminDeleteClass: lambda.Function;
  adminListBookings: lambda.Function;
  seedClasses: lambda.Function;
}

export class BalanceBookingFunctionsStack extends cdk.Stack {
  public readonly functions: BookingFunctions;

  constructor(scope: Construct, id: string, props: BalanceBookingFunctionsStackProps) {
    super(scope, id, props);

    const { stage, isProdLike } = props;
    const removalPolicy = isProdLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const logRetention = isProdLike ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK;

    const make = (name: string, dir: string): lambda.Function => {
      const logGroup = new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/${stage}-balance-booking-${name}`,
        retention: logRetention,
        removalPolicy,
      });

      const fn = new nodejs.NodejsFunction(this, `${name}Fn`, {
        functionName: `${stage}-balance-booking-${name}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: path.join(__dirname, `../src/${dir}/index.ts`),
        bundling: {
          format: nodejs.OutputFormat.ESM,
          minify: isProdLike,
          sourceMap: !isProdLike,
          target: 'node20',
          mainFields: ['module', 'main'],
          banner:
            "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        },
        environment: {
          BOOKING_TABLE_NAME: props.bookingTable.tableName,
          STAGE: stage,
          LOG_LEVEL: isProdLike ? 'INFO' : 'DEBUG',
        },
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        logGroup,
      });

      props.bookingTable.grantReadWriteData(fn);
      return fn;
    };

    this.functions = {
      listClasses: make('list-classes', 'list-classes'),
      myProfile: make('me', 'me'),
      myBookings: make('list-my-bookings', 'list-my-bookings'),
      submitParq: make('parq-submit', 'parq-submit'),
      bookBasket: make('book-basket', 'book-basket'),
      cancelBooking: make('cancel-booking', 'cancel-booking'),
      adminCreateClass: make('admin-create-class', 'admin-create-class'),
      adminUpdateClass: make('admin-update-class', 'admin-update-class'),
      adminDeleteClass: make('admin-delete-class', 'admin-delete-class'),
      adminListBookings: make('admin-list-bookings', 'admin-list-bookings'),
      seedClasses: make('seed-classes', 'seed-classes'),
    };
  }
}
