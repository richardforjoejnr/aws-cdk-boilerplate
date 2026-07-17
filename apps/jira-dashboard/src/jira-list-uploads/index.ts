import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;

interface UploadRecord {
  uploadId: string;
  timestamp: string;
  fileName?: string;
  status: string;
  createdAt?: string;
  [key: string]: unknown;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Query all uploads using GSI
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: UPLOADS_TABLE,
        IndexName: 'TimestampIndex',
        KeyConditionExpression: '#type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'jira-upload',
        },
        ScanIndexForward: false, // Sort by timestamp descending (newest first)
        Limit: 100, // Get more to ensure we capture duplicates
      })
    );

    // Deduplicate by uploadId - keep most recent (which should be first due to sort order)
    const uploadsMap = new Map<string, UploadRecord>();
    for (const item of result.Items || []) {
      const upload = item as UploadRecord;
      if (!uploadsMap.has(upload.uploadId)) {
        uploadsMap.set(upload.uploadId, upload);
      } else {
        // If duplicate exists, prefer the one with more complete data (has fileName)
        const existing = uploadsMap.get(upload.uploadId);
        if (existing && upload.fileName && !existing.fileName) {
          uploadsMap.set(upload.uploadId, upload);
        } else if (existing && upload.status === 'failed' && existing.status === 'pending') {
          // Prefer failed status over pending for stuck uploads
          uploadsMap.set(upload.uploadId, upload);
        }
      }
    }

    // Convert map back to array and sort by timestamp
    const uniqueUploads = Array.from(uploadsMap.values())
      .sort((a, b) => new Date(b.createdAt || b.timestamp).getTime() - new Date(a.createdAt || a.timestamp).getTime())
      .slice(0, 50); // Limit to 50 after deduplication

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        uploads: uniqueUploads,
        count: uniqueUploads.length,
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
