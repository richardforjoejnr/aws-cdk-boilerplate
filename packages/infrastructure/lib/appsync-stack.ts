import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppSyncStackProps extends cdk.StackProps {
  mainTable: dynamodb.Table;
  helloWorldFunction: lambda.Function;
}

export class AppSyncStack extends cdk.Stack {
  public readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: AppSyncStackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') as string;
    const isProdLike = this.node.tryGetContext('isProdLike') as boolean;

    // Create the AppSync API
    this.api = new appsync.GraphqlApi(this, 'Api', {
      name: `${stage}-api`,
      definition: appsync.Definition.fromFile(path.join(__dirname, '../schema/schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: appsync.AuthorizationType.IAM,
          },
        ],
      },
      xrayEnabled: isProdLike,
      logConfig: {
        fieldLogLevel: isProdLike ? appsync.FieldLogLevel.ERROR : appsync.FieldLogLevel.ALL,
        excludeVerboseContent: isProdLike,
      },
    });

    // DynamoDB data source
    const dynamoDbDataSource = this.api.addDynamoDbDataSource(
      'DynamoDbDataSource',
      props.mainTable
    );

    // Lambda data source
    const lambdaDataSource = this.api.addLambdaDataSource(
      'LambdaDataSource',
      props.helloWorldFunction
    );

    // Query: Get item by ID
    dynamoDbDataSource.createResolver('GetItemResolver', {
      typeName: 'Query',
      fieldName: 'getItem',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "pk": $util.dynamodb.toDynamoDBJson($ctx.args.id),
            "sk": $util.dynamodb.toDynamoDBJson("ITEM")
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Query: List all items
    dynamoDbDataSource.createResolver('ListItemsResolver', {
      typeName: 'Query',
      fieldName: 'listItems',
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbScanTable(),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList(),
    });

    // Mutation: Create item
    dynamoDbDataSource.createResolver('CreateItemResolver', {
      typeName: 'Mutation',
      fieldName: 'createItem',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "PutItem",
          "key": {
            "pk": $util.dynamodb.toDynamoDBJson($util.autoId()),
            "sk": $util.dynamodb.toDynamoDBJson("ITEM")
          },
          "attributeValues": {
            "name": $util.dynamodb.toDynamoDBJson($ctx.args.input.name),
            "description": $util.dynamodb.toDynamoDBJson($ctx.args.input.description),
            "createdAt": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
            "updatedAt": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601())
          },
          "condition": {
            "expression": "attribute_not_exists(pk)"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Mutation: Update item
    dynamoDbDataSource.createResolver('UpdateItemResolver', {
      typeName: 'Mutation',
      fieldName: 'updateItem',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "pk": $util.dynamodb.toDynamoDBJson($ctx.args.id),
            "sk": $util.dynamodb.toDynamoDBJson("ITEM")
          },
          "update": {
            "expression": "SET #name = :name, #description = :description, #updatedAt = :updatedAt",
            "expressionNames": {
              "#name": "name",
              "#description": "description",
              "#updatedAt": "updatedAt"
            },
            "expressionValues": {
              ":name": $util.dynamodb.toDynamoDBJson($ctx.args.input.name),
              ":description": $util.dynamodb.toDynamoDBJson($ctx.args.input.description),
              ":updatedAt": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601())
            }
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Mutation: Delete item
    dynamoDbDataSource.createResolver('DeleteItemResolver', {
      typeName: 'Mutation',
      fieldName: 'deleteItem',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "DeleteItem",
          "key": {
            "pk": $util.dynamodb.toDynamoDBJson($ctx.args.id),
            "sk": $util.dynamodb.toDynamoDBJson("ITEM")
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    // Query: Invoke Lambda
    lambdaDataSource.createResolver('InvokeLambdaResolver', {
      typeName: 'Query',
      fieldName: 'hello',
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    // Outputs
    new cdk.CfnOutput(this, 'GraphQLApiUrl', {
      value: this.api.graphqlUrl,
      description: 'GraphQL API URL',
      exportName: `${stage}-graphql-url`,
    });

    new cdk.CfnOutput(this, 'GraphQLApiKey', {
      value: this.api.apiKey || 'N/A',
      description: 'GraphQL API Key',
      exportName: `${stage}-graphql-api-key`,
    });

    new cdk.CfnOutput(this, 'GraphQLApiId', {
      value: this.api.apiId,
      description: 'GraphQL API ID',
      exportName: `${stage}-graphql-api-id`,
    });
  }
}
