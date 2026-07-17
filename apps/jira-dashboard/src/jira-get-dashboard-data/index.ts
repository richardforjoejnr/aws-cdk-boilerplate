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

    console.log(`🎯 PHASE 3: Getting dashboard data from upload record (no issues table query!)`);

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
      metrics: Record<string, unknown>;
      topLists?: {
        openBugs: unknown[];
        unassignedIssues: unknown[];
        recentIssues: unknown[];
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

    // PHASE 3: Use pre-computed metrics and top lists from upload record
    // NO MORE QUERYING 9,677 ISSUES FROM DYNAMODB!

    const metrics = upload.metrics as {
      byStatus: Record<string, number>;
      byPriority: Record<string, number>;
      byType: Record<string, number>;
      byAssignee: Record<string, number>;
      [key: string]: unknown;
    };

    const topLists = upload.topLists || {
      openBugs: [],
      unassignedIssues: [],
      recentIssues: [],
    };

    console.log(`✅ PHASE 3: Returning pre-computed data - 0 DynamoDB reads for issues!`);
    console.log(`📊 Top lists: ${topLists.openBugs.length} bugs, ${topLists.unassignedIssues.length} unassigned, ${topLists.recentIssues.length} recent`);

    // Calculate detailed metrics for the dashboard
    const dashboardData = {
      upload,
      summary: {
        totalIssues: upload.metrics.totalIssues || 0,
        ...upload.metrics,
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
        // PHASE 3: Use pre-computed top lists instead of querying issues table
        openBugs: topLists.openBugs,
        recentIssues: topLists.recentIssues,
        unassignedIssues: topLists.unassignedIssues,
      },
    };

    console.log(`💰 Cost savings: 0 WCUs (vs ~${Math.ceil((upload.metrics.totalIssues as number || 0) / 100)} WCUs in old approach)`);

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
