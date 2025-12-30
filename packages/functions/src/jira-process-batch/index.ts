import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

interface ProcessBatchInput {
  uploadId: string;
  timestamp: string;
  bucket: string;
  key: string;
  startRow: number;
  batchSize: number;
  totalRows?: number;
}

interface ProcessBatchOutput {
  uploadId: string;
  timestamp: string;
  bucket: string;
  key: string;
  startRow: number;
  batchSize: number;
  totalRows: number;
  processedRows: number;
  hasMore: boolean;
  nextStartRow?: number;
}

export const handler = async (event: ProcessBatchInput): Promise<ProcessBatchOutput> => {
  console.log('Processing batch:', JSON.stringify(event, null, 2));

  const { uploadId, timestamp, bucket, key, startRow, batchSize } = event;

  try {
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
      relax_column_count: true,
    });

    let rowCount = 0;
    let currentRow = 1; // Start at 1 (header is row 0)

    for await (const row of bodyStream.pipe(parser)) {
      // Skip rows before startRow
      if (currentRow < startRow) {
        currentRow++;
        continue;
      }

      // Stop if we've processed batchSize rows
      if (rowCount >= batchSize) {
        break;
      }

      currentRow++;
      try {
        rowCount++;
        const record = row as CsvRecord;

        // Map CSV columns to our schema
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
        console.error(`Error parsing row ${rowCount}:`, error);
      }
    }

    console.log(`Parsed ${issues.length} issues from batch starting at row ${startRow}`);

    // Batch write issues to DynamoDB (max 25 items per batch)
    const dynamoBatchSize = 25;
    let processedCount = 0;

    for (let i = 0; i < issues.length; i += dynamoBatchSize) {
      const batch = issues.slice(i, i + dynamoBatchSize);

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

      await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [ISSUES_TABLE]: putRequests,
          },
        })
      );
      processedCount += batch.length;
    }

    // Determine if there are more rows to process
    const totalRows = event.totalRows || (startRow + issues.length);
    const hasMore = issues.length === batchSize;
    const nextStartRow = hasMore ? startRow + batchSize : undefined;

    // Update upload progress
    await dynamoClient.send(
      new UpdateCommand({
        TableName: UPLOADS_TABLE,
        Key: {
          uploadId,
          timestamp,
        },
        UpdateExpression: 'SET processedIssues = if_not_exists(processedIssues, :zero) + :processed, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':processed': processedCount,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    console.log(`Batch complete: processed ${processedCount} issues, hasMore: ${hasMore}`);

    return {
      uploadId,
      timestamp,
      bucket,
      key,
      startRow,
      batchSize,
      totalRows,
      processedRows: processedCount,
      hasMore,
      nextStartRow,
    };
  } catch (error) {
    console.error('Error processing batch:', error);
    throw error;
  }
};
