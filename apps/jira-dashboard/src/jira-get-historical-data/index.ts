import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Get all completed uploads
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
        ScanIndexForward: true, // Sort by timestamp ascending (oldest first)
      })
    );

    interface UploadItem {
      uploadId: string;
      status: string;
      timestamp: string;
      fileName: string;
      totalIssues: number;
      metrics?: {
        bugs?: { total: number; open: number };
        thisMonth?: { created: number; closed: number };
        byStatus?: Record<string, number>;
        byPriority?: Record<string, number>;
        unassigned?: number;
      };
    }

    const uploads = ((result.Items || []) as UploadItem[]).filter((upload) => upload.status === 'completed');

    // Calculate historical trends
    const trends = {
      totalIssuesOverTime: uploads.map((upload) => ({
        date: String(upload.timestamp),
        fileName: String(upload.fileName),
        totalIssues: Number(upload.totalIssues) || 0,
      })),
      bugsOverTime: uploads.map((upload) => ({
        date: String(upload.timestamp),
        fileName: String(upload.fileName),
        totalBugs: Number(upload.metrics?.bugs?.total) || 0,
        openBugs: Number(upload.metrics?.bugs?.open) || 0,
      })),
      issuesCreatedPerMonth: uploads.map((upload) => ({
        date: String(upload.timestamp),
        fileName: String(upload.fileName),
        created: Number(upload.metrics?.thisMonth?.created) || 0,
        closed: Number(upload.metrics?.thisMonth?.closed) || 0,
      })),
      statusTrends: uploads.map((upload) => ({
        date: String(upload.timestamp),
        fileName: String(upload.fileName),
        ...(upload.metrics?.byStatus || {}),
      })),
      priorityTrends: uploads.map((upload) => ({
        date: String(upload.timestamp),
        fileName: String(upload.fileName),
        ...(upload.metrics?.byPriority || {}),
      })),
      unassignedTrends: uploads.map((upload) => ({
        date: String(upload.timestamp),
        fileName: String(upload.fileName),
        unassigned: Number(upload.metrics?.unassigned) || 0,
      })),
    };

    // Calculate aggregate statistics
    const aggregateStats = {
      totalUploads: uploads.length,
      averageIssuesPerUpload:
        uploads.reduce((sum, u) => sum + (Number(u.totalIssues) || 0), 0) / uploads.length || 0,
      averageBugsPerUpload:
        uploads.reduce((sum, u) => sum + (Number(u.metrics?.bugs?.total) || 0), 0) / uploads.length || 0,
      latestUpload: uploads[uploads.length - 1] || null,
      oldestUpload: uploads[0] || null,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        trends,
        aggregateStats,
        uploads: uploads.map((u) => ({
          uploadId: u.uploadId,
          timestamp: u.timestamp,
          fileName: u.fileName,
          totalIssues: u.totalIssues,
        })),
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
