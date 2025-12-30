import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

const s3Client = new S3Client({});
const ddbClient = new DynamoDBClient({});
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;
const ISSUES_TABLE = process.env.ISSUES_TABLE!;

interface JiraIssue {
  summary: string;
  issueKey: string;
  issueId: string;
  issueType: string;
  status: string;
  priority: string;
  assignee: string;
  created: string;
  updated: string;
  resolved?: string;
  projectKey: string;
  projectName: string;
  [key: string]: string | undefined;
}

interface CsvRecord {
  [key: string]: string;
}

export const handler = async (event: S3Event): Promise<void> => {
  console.log('Processing S3 event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const uploadId = key.split('/')[0]; // Assuming format: uploadId/filename.csv

    // Query to get the actual timestamp for this upload (before try block so it's available in catch)
    let timestamp: string | undefined;
    try {
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

      if (!uploadQuery.Items || uploadQuery.Items.length === 0) {
        throw new Error(`Upload record not found for uploadId: ${uploadId}`);
      }

      timestamp = uploadQuery.Items[0].timestamp as string;

      console.log(`Processing CSV file: ${key} from bucket: ${bucket}`);

      // Update upload status to processing
      await dynamoClient.send(
        new UpdateCommand({
          TableName: UPLOADS_TABLE,
          Key: {
            uploadId,
            timestamp,
          },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, processedIssues = :processedIssues, totalIssues = :totalIssues',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'processing',
            ':updatedAt': new Date().toISOString(),
            ':processedIssues': 0,
            ':totalIssues': 0,
          },
        })
      );

      // Get CSV from S3
      const getObjectResponse = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      if (!getObjectResponse.Body) {
        throw new Error('No body in S3 response');
      }

      // Parse CSV
      const issues: JiraIssue[] = [];
      const bodyStream = getObjectResponse.Body;

      if (!(bodyStream instanceof Readable)) {
        throw new Error('S3 response body is not a readable stream');
      }

      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true, // Handle inconsistent column counts
      });

      let rowCount = 0;
      let errorCount = 0;

      for await (const row of bodyStream.pipe(parser)) {
        try {
          rowCount++;
          const record = row as CsvRecord;

          // Map CSV columns to our schema - extract known fields first
          const {
            'Summary': _summary,
            'Issue key': _issueKey,
            'Issue id': _issueId,
            'Issue Type': _issueType,
            'Status': _status,
            'Priority': _priority,
            'Assignee': _assignee,
            'Created': _created,
            'Updated': _updated,
            'Resolved': _resolved,
            'Project key': _projectKey,
            'Project name': _projectName,
            ...otherFields
          } = record;

          const issue: JiraIssue = {
            summary: record['Summary'] || '',
            issueKey: record['Issue key'] || '',
            issueId: record['Issue id'] || '',
            issueType: record['Issue Type'] || '',
            status: record['Status'] || '',
            priority: record['Priority'] || '',
            assignee: record['Assignee'] || 'Unassigned',
            created: record['Created'] || '',
            updated: record['Updated'] || '',
            resolved: record['Resolved'] || undefined,
            projectKey: record['Project key'] || '',
            projectName: record['Project name'] || '',
            ...otherFields,
          };

          issues.push(issue);
        } catch (error) {
          errorCount++;
          console.error(`Error parsing row ${rowCount}:`, error);
        }
      }

      console.log(`Parsed ${issues.length} issues from CSV (${errorCount} errors)`);

      // Update total issues count
      await dynamoClient.send(
        new UpdateCommand({
          TableName: UPLOADS_TABLE,
          Key: {
            uploadId,
            timestamp,
          },
          UpdateExpression: 'SET totalIssues = :totalIssues, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':totalIssues': issues.length,
            ':updatedAt': new Date().toISOString(),
          },
        })
      );

      // Batch write issues to DynamoDB (max 25 items per batch)
      const batchSize = 25;
      let processedCount = 0;

      for (let i = 0; i < issues.length; i += batchSize) {
        const batch = issues.slice(i, i + batchSize);

        const putRequests = batch.map((issue) => ({
          PutRequest: {
            Item: {
              ...issue,
              issueKey: issue.issueKey,
              uploadId,
              uploadedAt: new Date().toISOString(),
            },
          },
        }));

        try {
          await dynamoClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [ISSUES_TABLE]: putRequests,
              },
            })
          );
          processedCount += batch.length;
          console.log(`Batch ${i / batchSize + 1}: Wrote ${batch.length} items (total: ${processedCount}/${issues.length})`);

          // Update progress after each batch
          await dynamoClient.send(
            new UpdateCommand({
              TableName: UPLOADS_TABLE,
              Key: {
                uploadId,
                timestamp,
              },
              UpdateExpression: 'SET processedIssues = :processedIssues, updatedAt = :updatedAt',
              ExpressionAttributeValues: {
                ':processedIssues': processedCount,
                ':updatedAt': new Date().toISOString(),
              },
            })
          );
        } catch (error) {
          console.error(`Error writing batch ${i / batchSize + 1}:`, error);
          throw error;
        }
      }

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
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, totalIssues = :totalIssues, metrics = :metrics, fileName = :fileName',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'completed',
            ':updatedAt': new Date().toISOString(),
            ':totalIssues': issues.length,
            ':metrics': metrics,
            ':fileName': key.split('/').pop(),
          },
        })
      );

      console.log(`Successfully processed ${processedCount} issues for upload ${uploadId}`);
    } catch (error) {
      console.error(`Error processing ${key}:`, error);

      // Update upload status to failed (only if we have timestamp)
      if (timestamp) {
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
      } else {
        console.error('Cannot update upload status - timestamp not found');
      }

      throw error;
    }
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
    metrics.byStatus[issue.status] = (metrics.byStatus[issue.status] || 0) + 1;

    // Count by priority
    metrics.byPriority[issue.priority] = (metrics.byPriority[issue.priority] || 0) + 1;

    // Count by type
    metrics.byType[issue.issueType] = (metrics.byType[issue.issueType] || 0) + 1;

    // Count by assignee
    if (!issue.assignee || issue.assignee === 'Unassigned') {
      metrics.unassigned++;
    } else {
      metrics.byAssignee[issue.assignee] = (metrics.byAssignee[issue.assignee] || 0) + 1;
    }

    // Bug-specific metrics
    if (issue.issueType.toLowerCase().includes('bug')) {
      metrics.bugs.total++;

      if (!['done', 'closed', 'resolved'].some(s => issue.status.toLowerCase().includes(s))) {
        metrics.bugs.open++;
      }

      metrics.bugs.byPriority[issue.priority] = (metrics.bugs.byPriority[issue.priority] || 0) + 1;
    }

    // This month metrics
    const createdDate = new Date(issue.created);
    if (createdDate.getMonth() === currentMonth && createdDate.getFullYear() === currentYear) {
      metrics.thisMonth.created++;
      if (issue.issueType.toLowerCase().includes('bug')) {
        metrics.thisMonth.bugsCreated++;
      }
    }

    if (issue.resolved) {
      const resolvedDate = new Date(issue.resolved);
      if (resolvedDate.getMonth() === currentMonth && resolvedDate.getFullYear() === currentYear) {
        metrics.thisMonth.closed++;
        if (issue.issueType.toLowerCase().includes('bug')) {
          metrics.thisMonth.bugsClosed++;
        }
      }
    }
  });

  return metrics;
}
