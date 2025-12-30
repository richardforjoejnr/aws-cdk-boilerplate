import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;
const ISSUES_TABLE = process.env.ISSUES_TABLE!;

interface JiraIssue {
  issueKey: string;
  issueType: string;
  status: string;
  priority: string;
  assignee: string;
  created: string;
  resolved?: string;
  [key: string]: string | undefined;
}

interface FinalizeInput {
  uploadId: string;
  timestamp: string;
  fileName: string;
}

export const handler = async (event: FinalizeInput): Promise<{ status: string }> => {
  console.log('Finalizing upload:', JSON.stringify(event, null, 2));

  const { uploadId, timestamp, fileName } = event;

  try {
    // Query all issues for this upload to calculate metrics
    const issues: JiraIssue[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: ISSUES_TABLE,
          IndexName: 'UploadIndex',
          KeyConditionExpression: 'uploadId = :uploadId',
          ExpressionAttributeValues: {
            ':uploadId': uploadId,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (result.Items) {
        issues.push(...(result.Items as JiraIssue[]));
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    console.log(`Found ${issues.length} total issues for upload ${uploadId}`);

    // Calculate metrics
    const metrics = calculateMetrics(issues);

    // Update upload status to completed with metrics
    await dynamoClient.send(
      new UpdateCommand({
        TableName: UPLOADS_TABLE,
        Key: {
          uploadId,
          timestamp,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, totalIssues = :totalIssues, metrics = :metrics, fileName = :fileName, processedIssues = :processedIssues',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':updatedAt': new Date().toISOString(),
          ':totalIssues': issues.length,
          ':metrics': metrics,
          ':fileName': fileName,
          ':processedIssues': issues.length,
        },
      })
    );

    console.log(`Successfully finalized upload ${uploadId} with ${issues.length} issues`);

    return { status: 'completed' };
  } catch (error) {
    console.error('Error finalizing upload:', error);

    // Update upload status to failed
    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: UPLOADS_TABLE,
          Key: {
            uploadId,
            timestamp,
          },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, errorMessage = :errorMessage',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'failed',
            ':updatedAt': new Date().toISOString(),
            ':errorMessage': error instanceof Error ? error.message : String(error),
          },
        })
      );
    } catch (updateError) {
      console.error('Error updating upload status to failed:', updateError);
    }

    throw error;
  }
};

function calculateMetrics(issues: JiraIssue[]) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const metrics = {
    totalIssues: issues.length,
    byStatus: {} as Record<string, number>,
    byPriority: {} as Record<string, number>,
    byType: {} as Record<string, number>,
    byAssignee: {} as Record<string, number>,
    bugs: {
      total: 0,
      open: 0,
      bySeverity: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
    },
    thisMonth: {
      created: 0,
      closed: 0,
      bugsCreated: 0,
      bugsClosed: 0,
    },
    unassigned: 0,
  };

  issues.forEach((issue) => {
    // Count by status
    if (issue.status) {
      metrics.byStatus[issue.status] = (metrics.byStatus[issue.status] || 0) + 1;
    }

    // Count by priority
    if (issue.priority) {
      metrics.byPriority[issue.priority] = (metrics.byPriority[issue.priority] || 0) + 1;
    }

    // Count by type
    if (issue.issueType) {
      metrics.byType[issue.issueType] = (metrics.byType[issue.issueType] || 0) + 1;
    }

    // Count by assignee
    if (!issue.assignee || issue.assignee === 'Unassigned') {
      metrics.unassigned++;
    } else {
      metrics.byAssignee[issue.assignee] = (metrics.byAssignee[issue.assignee] || 0) + 1;
    }

    // Bug-specific metrics
    if (issue.issueType && issue.issueType.toLowerCase().includes('bug')) {
      metrics.bugs.total++;

      if (issue.status && !['done', 'closed', 'resolved'].some(s => issue.status.toLowerCase().includes(s))) {
        metrics.bugs.open++;
      }

      if (issue.priority) {
        metrics.bugs.byPriority[issue.priority] = (metrics.bugs.byPriority[issue.priority] || 0) + 1;
      }
    }

    // This month metrics
    if (issue.created) {
      const createdDate = new Date(issue.created);
      if (createdDate.getMonth() === currentMonth && createdDate.getFullYear() === currentYear) {
        metrics.thisMonth.created++;
        if (issue.issueType && issue.issueType.toLowerCase().includes('bug')) {
          metrics.thisMonth.bugsCreated++;
        }
      }
    }

    if (issue.resolved) {
      const resolvedDate = new Date(issue.resolved);
      if (resolvedDate.getMonth() === currentMonth && resolvedDate.getFullYear() === currentYear) {
        metrics.thisMonth.closed++;
        if (issue.issueType && issue.issueType.toLowerCase().includes('bug')) {
          metrics.thisMonth.bugsClosed++;
        }
      }
    }
  });

  return metrics;
}
