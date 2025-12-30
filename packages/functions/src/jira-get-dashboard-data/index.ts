import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

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

    // Get upload metadata
    const uploadResult = await dynamoClient.send(
      new GetCommand({
        TableName: UPLOADS_TABLE,
        Key: {
          uploadId,
          timestamp: uploadId,
        },
      })
    );

    if (!uploadResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Upload not found' }),
      };
    }

    const upload = uploadResult.Item;

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

    const issues = issuesResult.Items || [];

    // Calculate detailed metrics for the dashboard
    const dashboardData = {
      upload,
      summary: {
        totalIssues: issues.length,
        ...upload.metrics,
      },
      charts: {
        statusDistribution: Object.entries(upload.metrics.byStatus).map(([name, value]) => ({
          name,
          value,
        })),
        priorityDistribution: Object.entries(upload.metrics.byPriority).map(([name, value]) => ({
          name,
          value,
        })),
        typeDistribution: Object.entries(upload.metrics.byType).map(([name, value]) => ({
          name,
          value,
        })),
        assigneeDistribution: Object.entries(upload.metrics.byAssignee)
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
            i.issueType.toLowerCase().includes('bug') &&
            !['done', 'closed', 'resolved'].some((s) => i.status.toLowerCase().includes(s))
        ),
        recentIssues: issues
          .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
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
