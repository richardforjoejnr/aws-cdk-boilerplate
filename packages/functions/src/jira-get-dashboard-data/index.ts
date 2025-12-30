import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

    // Get upload metadata (query by uploadId to get the latest record)
    const uploadResult = await dynamoClient.send(
      new QueryCommand({
        TableName: UPLOADS_TABLE,
        KeyConditionExpression: 'uploadId = :uploadId',
        ExpressionAttributeValues: {
          ':uploadId': uploadId,
        },
        Limit: 1,
        ScanIndexForward: false, // Get the most recent timestamp first
      })
    );

    if (!uploadResult.Items || uploadResult.Items.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Upload not found' }),
      };
    }

    const upload = uploadResult.Items[0] as {
      status: string;
      metrics: {
        byStatus: Record<string, number>;
        byPriority: Record<string, number>;
        byType: Record<string, number>;
        byAssignee: Record<string, number>;
      };
      [key: string]: unknown;
    };

    // If upload is not completed yet, return status
    if (upload.status !== 'completed') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          upload,
          status: upload.status,
          message: upload.status === 'processing' ? 'Upload is being processed' : 'Upload not yet completed',
        }),
      };
    }

    // Get all issues for this upload
    const issuesResult = await dynamoClient.send(
      new QueryCommand({
        TableName: ISSUES_TABLE,
        IndexName: 'UploadIndex',
        KeyConditionExpression: 'uploadId = :uploadId',
        ExpressionAttributeValues: {
          ':uploadId': uploadId,
        },
      })
    );

    const issues = (issuesResult.Items || []) as Array<{
      issueType: string;
      status: string;
      created: string;
      assignee: string;
      [key: string]: unknown;
    }>;

    const metrics = upload.metrics as {
      byStatus: Record<string, number>;
      byPriority: Record<string, number>;
      byType: Record<string, number>;
      byAssignee: Record<string, number>;
    };

    // Calculate detailed metrics for the dashboard
    const dashboardData = {
      upload,
      summary: {
        totalIssues: issues.length,
        ...(upload.metrics as Record<string, unknown>),
      },
      charts: {
        statusDistribution: Object.entries(metrics.byStatus).map(([name, value]) => ({
          name,
          value,
        })),
        priorityDistribution: Object.entries(metrics.byPriority).map(([name, value]) => ({
          name,
          value,
        })),
        typeDistribution: Object.entries(metrics.byType).map(([name, value]) => ({
          name,
          value,
        })),
        assigneeDistribution: Object.entries(metrics.byAssignee)
          .map(([name, value]) => ({
            name,
            value,
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10), // Top 10 assignees
      },
      lists: {
        openBugs: issues.filter(
          (i) =>
            String(i.issueType).toLowerCase().includes('bug') &&
            !['done', 'closed', 'resolved'].some((s) => String(i.status).toLowerCase().includes(s))
        ),
        recentIssues: issues
          .sort((a, b) => new Date(String(b.created)).getTime() - new Date(String(a.created)).getTime())
          .slice(0, 20),
        unassignedIssues: issues.filter((i) => !i.assignee || i.assignee === 'Unassigned'),
      },
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(dashboardData),
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
