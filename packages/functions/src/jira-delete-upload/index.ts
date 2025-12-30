import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CSV_BUCKET = process.env.CSV_BUCKET!;
const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;
const ISSUES_TABLE = process.env.ISSUES_TABLE!;

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

    // 1. Delete all issues for this upload from DynamoDB
    const issuesQuery = await dynamoClient.send(
      new QueryCommand({
        TableName: ISSUES_TABLE,
        IndexName: 'UploadIndex',
        KeyConditionExpression: 'uploadId = :uploadId',
        ExpressionAttributeValues: {
          ':uploadId': uploadId,
        },
      })
    );

    if (issuesQuery.Items && issuesQuery.Items.length > 0) {
      // Delete issues in batches (max 25 per batch)
      for (let i = 0; i < issuesQuery.Items.length; i += 25) {
        const batch = issuesQuery.Items.slice(i, i + 25);
        const deletePromises = batch.map((item) =>
          dynamoClient.send(
            new DeleteCommand({
              TableName: ISSUES_TABLE,
              Key: {
                issueKey: item.issueKey,
                uploadId: item.uploadId,
              },
            })
          )
        );
        await Promise.all(deletePromises);
      }
    }

    // 2. Delete CSV files from S3
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: CSV_BUCKET,
        Prefix: `${uploadId}/`,
      })
    );

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: CSV_BUCKET,
          Delete: {
            Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key! })),
          },
        })
      );
    }

    // 3. Delete upload record from DynamoDB
    // Query to get the full key (uploadId + timestamp)
    const uploadQuery = await dynamoClient.send(
      new QueryCommand({
        TableName: UPLOADS_TABLE,
        KeyConditionExpression: 'uploadId = :uploadId',
        ExpressionAttributeValues: {
          ':uploadId': uploadId,
        },
        Limit: 1,
      })
    );

    if (uploadQuery.Items && uploadQuery.Items.length > 0) {
      await dynamoClient.send(
        new DeleteCommand({
          TableName: UPLOADS_TABLE,
          Key: {
            uploadId: uploadQuery.Items[0].uploadId,
            timestamp: uploadQuery.Items[0].timestamp,
          },
        })
      );
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Upload deleted successfully',
        uploadId,
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
