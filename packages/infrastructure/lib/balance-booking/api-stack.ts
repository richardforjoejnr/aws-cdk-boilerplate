import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { BookingFunctions } from './functions-stack.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BalanceBookingApiStackProps extends cdk.StackProps {
  stage: string;
  isProdLike: boolean;
  userPool: cognito.UserPool;
  functions: BookingFunctions;
}

export class BalanceBookingApiStack extends cdk.Stack {
  public readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: BalanceBookingApiStackProps) {
    super(scope, id, props);

    const { stage, isProdLike } = props;

    this.api = new appsync.GraphqlApi(this, 'Api', {
      name: `${stage}-balance-booking-api`,
      definition: appsync.Definition.fromFile(path.join(__dirname, 'schema.graphql')),
      authorizationConfig: {
        // Default = Cognito user pool: anything tagged @aws_cognito_user_pools requires a signed-in user.
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool: props.userPool },
        },
        additionalAuthorizationModes: [
          // API_KEY: lets the public schedule load before sign-in. Only fields tagged
          // @aws_api_key in schema.graphql are accessible this way.
          {
            authorizationType: appsync.AuthorizationType.API_KEY,
            apiKeyConfig: {
              expires: cdk.Expiration.after(cdk.Duration.days(365)),
              description: 'Public read access (schedule browse before sign-in)',
            },
          },
          { authorizationType: appsync.AuthorizationType.IAM },
        ],
      },
      xrayEnabled: isProdLike,
      logConfig: {
        fieldLogLevel: isProdLike ? appsync.FieldLogLevel.ERROR : appsync.FieldLogLevel.ALL,
        excludeVerboseContent: isProdLike,
      },
    });

    const wire = (
      typeName: 'Query' | 'Mutation',
      fieldName: string,
      fn: cdk.aws_lambda.IFunction
    ): void => {
      const ds = this.api.addLambdaDataSource(`${fieldName}Ds`, fn);
      ds.createResolver(`${fieldName}Resolver`, {
        typeName,
        fieldName,
        requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
        responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
      });
    };

    wire('Query', 'listClasses', props.functions.listClasses);
    wire('Query', 'myProfile', props.functions.myProfile);
    wire('Query', 'myBookings', props.functions.myBookings);
    wire('Query', 'adminListBookings', props.functions.adminListBookings);

    wire('Mutation', 'submitParq', props.functions.submitParq);
    wire('Mutation', 'bookBasket', props.functions.bookBasket);
    wire('Mutation', 'cancelBooking', props.functions.cancelBooking);
    wire('Mutation', 'adminCreateClass', props.functions.adminCreateClass);
    wire('Mutation', 'adminUpdateClass', props.functions.adminUpdateClass);
    wire('Mutation', 'adminDeleteClass', props.functions.adminDeleteClass);

    new cdk.CfnOutput(this, 'GraphqlUrl', {
      value: this.api.graphqlUrl,
      exportName: `${stage}-balance-booking-graphql-url`,
    });
    new cdk.CfnOutput(this, 'GraphqlApiKey', {
      value: this.api.apiKey ?? 'N/A',
      exportName: `${stage}-balance-booking-graphql-api-key`,
    });
    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.apiId,
      exportName: `${stage}-balance-booking-api-id`,
    });
  }
}
