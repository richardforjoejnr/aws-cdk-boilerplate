import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CSV_BUCKET = process.env.CSV_BUCKET!;
const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;

interface UploadRequest {
  fileName: string;
  description?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const body: UploadRequest = JSON.parse(event.body);

    if (!body.fileName) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'fileName is required' }),
      };
    }

    // Validate file extension
    if (!body.fileName.toLowerCase().endsWith('.csv')) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Only CSV files are supported' }),
      };
    }

    const uploadId = uuidv4();
    const timestamp = new Date().toISOString();
    const key = `${uploadId}/${body.fileName}`;

    // Create upload record in DynamoDB
    await dynamoClient.send(
      new PutCommand({
        TableName: UPLOADS_TABLE,
        Item: {
          uploadId,
          timestamp,
          type: 'jira-upload',
          fileName: body.fileName,
          description: body.description || '',
          status: 'pending',
          createdAt: timestamp,
          s3Key: key,
        },
      })
    );

    // Generate presigned URL for S3 upload
    const command = new PutObjectCommand({
      Bucket: CSV_BUCKET,
      Key: key,
      ContentType: 'text/csv',
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // URL expires in 1 hour
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        uploadId,
        presignedUrl,
        message: 'Upload URL generated successfully',
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
