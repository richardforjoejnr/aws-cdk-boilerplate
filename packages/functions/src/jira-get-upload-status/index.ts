import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const uploadId = event.pathParameters?.uploadId;

    if (!uploadId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'uploadId is required' }),
      };
    }

    // Query the upload
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: UPLOADS_TABLE,
        KeyConditionExpression: 'uploadId = :uploadId',
        ExpressionAttributeValues: {
          ':uploadId': uploadId,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Upload not found' }),
      };
    }

    const upload = result.Items[0];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        uploadId: upload.uploadId,
        status: upload.status,
        totalIssues: upload.totalIssues || 0,
        processedIssues: upload.processedIssues || 0,
        progress: upload.processedIssues && upload.totalIssues
          ? Math.round((upload.processedIssues / upload.totalIssues) * 100)
          : 0,
        errorMessage: upload.errorMessage,
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
