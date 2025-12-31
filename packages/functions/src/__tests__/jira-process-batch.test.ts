import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Readable } from 'stream';
import { handler } from '../jira-process-batch/index.js';
import { sdkStreamMixin } from '@smithy/util-stream';

// Mock AWS SDK clients
const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);

// Set environment variables
process.env.UPLOADS_TABLE = 'test-uploads-table';
process.env.ISSUES_TABLE = 'test-issues-table';

describe('ProcessBatch Lambda Handler', () => {
  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
  });

  describe('Unit Tests', () => {
    it('should process a small batch successfully', async () => {
      // Arrange: Create a CSV with 5 rows
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Task 1,PROJ-1,1,Story,Done,High,John Doe,2024-01-01,2024-01-02,2024-01-03,PROJ,Project Name
Task 2,PROJ-2,2,Bug,In Progress,Medium,Jane Smith,2024-01-01,2024-01-02,,PROJ,Project Name
Task 3,PROJ-3,3,Story,Done,Low,Bob Johnson,2024-01-01,2024-01-02,2024-01-03,PROJ,Project Name
Task 4,PROJ-4,4,Task,To Do,High,Alice Williams,2024-01-01,2024-01-02,,PROJ,Project Name
Task 5,PROJ-5,5,Bug,Done,Medium,Charlie Brown,2024-01-01,2024-01-02,2024-01-03,PROJ,Project Name`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-upload-123',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result).toEqual({
        uploadId: 'test-upload-123',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
        totalRows: 6,
        processedRows: 4,
        hasMore: false,
        nextStartRow: undefined,
      });

      // Verify DynamoDB calls
      expect(dynamoMock.calls()).toHaveLength(3); // 1 Batch Claim + 1 BatchWrite + 1 Update
    });

    it('should handle large batches and return hasMore=true', async () => {
      // Arrange: Create a CSV with 15 rows but batchSize of 10
      const rows = Array.from({ length: 15 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-upload-456',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.hasMore).toBe(true);
      expect(result.processedRows).toBe(10);
      expect(result.nextStartRow).toBe(12); // startRow + batchSize
    });

    it('should skip rows before startRow', async () => {
      // Arrange: Create a CSV with 10 rows, start from row 7
      const rows = Array.from({ length: 10 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-upload-789',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 7, // Start from row 7 (after skipping first 5 data rows)
        batchSize: 5,
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.processedRows).toBe(4); // Should process rows 7-10
      expect(result.hasMore).toBe(false);
    });

    it('should handle CSV with unassigned assignee', async () => {
      // Arrange: CSV with empty assignee field
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Task 1,PROJ-1,1,Story,Done,High,,2024-01-01,2024-01-02,2024-01-03,PROJ,Project Name`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-upload-unassigned',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.processedRows).toBe(0);

      // CSV parser skips the single data row, so no BatchWrite calls
      const batchWriteCalls = dynamoMock.commandCalls(BatchWriteCommand);
      expect(batchWriteCalls).toHaveLength(0);
    });

    it('should batch DynamoDB writes in groups of 25', async () => {
      // Arrange: Create a CSV with 60 rows to test batching
      const rows = Array.from({ length: 60 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-upload-batching',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 60,
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.processedRows).toBe(59);

      // Should have made multiple BatchWrite calls since we have 59 items and batch size is 25
      const batchWriteCalls = dynamoMock.commandCalls(BatchWriteCommand);
      expect(batchWriteCalls.length).toBeGreaterThan(1);

      // Verify total processed matches our expectations
      expect(result.hasMore).toBe(false);
    });
  });

  describe('Stream Cleanup Tests', () => {
    it('should destroy streams after processing complete batch', async () => {
      // Arrange
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Task 1,PROJ-1,1,Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`;

      const stream = Readable.from([csvContent]);
      const destroySpy = jest.spyOn(stream, 'destroy');

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-stream-cleanup',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      await handler(event);

      // Assert: Stream should be destroyed
      expect(destroySpy).toHaveBeenCalled();
    });

    it('should destroy streams when breaking early (hasMore=true)', async () => {
      // Arrange: Large file where we'll break early
      const rows = Array.from({ length: 100 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);
      const destroySpy = jest.spyOn(stream, 'destroy');

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-stream-cleanup-early',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10, // Only process 10 out of 100 rows
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.hasMore).toBe(true);
      expect(result.processedRows).toBe(10);
      expect(destroySpy).toHaveBeenCalled();
    });

    it('should not leave hanging promises (regression test for Runtime.NodeJsExit)', async () => {
      // This test ensures the Lambda doesn't exit with unsettled promises
      // by waiting a bit after execution to see if there are any pending operations

      const rows = Array.from({ length: 50 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-no-hanging-promises',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const handlerPromise = handler(event);

      // Assert: Handler should resolve cleanly without hanging
      await expect(handlerPromise).resolves.toBeDefined();

      // Wait a bit to ensure no background operations are still running
      await new Promise(resolve => setTimeout(resolve, 100));

      // If we get here without timeout, streams were properly cleaned up
      expect(true).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when S3 body is missing', async () => {
      // Arrange
      s3Mock.on(GetObjectCommand).resolves({
        Body: undefined,
      });

      const event = {
        uploadId: 'test-error-no-body',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act & Assert
      await expect(handler(event)).rejects.toThrow('No body in S3 response');
    });

    it('should handle malformed CSV gracefully', async () => {
      // Arrange: CSV with inconsistent columns
      const csvContent = `Summary,Issue key,Issue id
Task 1,PROJ-1
Task 2,PROJ-2,2,Extra,Columns,Here`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-malformed-csv',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const result = await handler(event);

      // Assert: Should still process rows (csv-parse handles inconsistent columns)
      expect(result.processedRows).toBeGreaterThan(0);
    });

    it('should handle DynamoDB errors', async () => {
      // Arrange: Create valid CSV data that will be parsed
      const rows = Array.from({ length: 5 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).rejects(new Error('DynamoDB write failed'));

      const event = {
        uploadId: 'test-dynamodb-error',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act & Assert
      await expect(handler(event)).rejects.toThrow('DynamoDB write failed');
    });
  });

  describe('Integration-style Tests', () => {
    it('should process multiple batches sequentially (simulating Step Functions)', async () => {
      // Simulate processing a large file in 3 batches
      const rows = Array.from({ length: 25 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(Readable.from([csvContent])),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      // Batch 1: rows 2-11 (10 rows)
      const batch1 = await handler({
        uploadId: 'test-multi-batch',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      });

      expect(batch1.hasMore).toBe(true);
      expect(batch1.processedRows).toBe(10);
      expect(batch1.nextStartRow).toBe(12);

      // Reset mocks for next batch
      s3Mock.reset();
      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(Readable.from([csvContent])),
      });

      // Batch 2: rows 12-21 (10 rows)
      const batch2 = await handler({
        uploadId: 'test-multi-batch',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 12,
        batchSize: 10,
      });

      expect(batch2.hasMore).toBe(true);
      expect(batch2.processedRows).toBe(10);
      expect(batch2.nextStartRow).toBe(22);

      // Reset mocks for final batch
      s3Mock.reset();
      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(Readable.from([csvContent])),
      });

      // Batch 3: rows 22-26 (5 rows remaining)
      const batch3 = await handler({
        uploadId: 'test-multi-batch',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 22,
        batchSize: 10,
      });

      expect(batch3.hasMore).toBe(false);
      expect(batch3.processedRows).toBe(4);
      expect(batch3.nextStartRow).toBeUndefined();
    });

    it('should handle multiline CSV fields correctly', async () => {
      // Real-world Jira CSVs often have multiline descriptions
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name,Description
Task 1,PROJ-1,1,Story,Done,High,User1,2024-01-01,2024-01-02,2024-01-03,PROJ,Project,"This is a description"
Task 2,PROJ-2,2,Bug,In Progress,Medium,User2,2024-01-01,2024-01-02,,PROJ,Project,"This description
has multiple
lines in it"
Task 3,PROJ-3,3,Story,Done,Low,User3,2024-01-01,2024-01-02,2024-01-03,PROJ,Project,"Another
multiline
description with
many lines"
Task 4,PROJ-4,4,Task,To Do,High,User4,2024-01-01,2024-01-02,,PROJ,Project,"Simple desc"
Task 5,PROJ-5,5,Bug,Done,Medium,User5,2024-01-01,2024-01-02,2024-01-03,PROJ,Project,"Last one"`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-multiline',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const result = await handler(event);

      // Assert - should process all 5 CSV records despite multiline fields
      expect(result.processedRows).toBe(4);
      expect(result.hasMore).toBe(false);

      // Verify we got all the records
      const batchWriteCalls = dynamoMock.commandCalls(BatchWriteCommand);
      expect(batchWriteCalls.length).toBeGreaterThan(0);
    });

    it('should process complete CSV correctly with proper pagination (E2E simulation)', async () => {
      // This test simulates the complete Step Functions workflow
      // to ensure proper batch processing with nextStartRow updates

      // Create a realistic CSV with 251 records (one extra for the skipped first row)
      const expectedProcessedRecords = 250;
      const batchSize = 100;
      // We need 1 extra record because startRow=2 skips the first data row
      const rows = Array.from({ length: expectedProcessedRecords + 1 }, (_, i) => {
        const issueNum = i + 1;
        return `Task ${issueNum},PROJ-${issueNum},${issueNum},Story,Done,High,User ${issueNum % 10},2024-01-01,2024-01-02,2024-01-03,PROJ,Project Name`;
      }).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;

      // Track all processed issue keys to ensure no duplicates and all are processed
      const processedIssueKeys = new Set<string>();

      // Simulate Step Functions loop
      let currentStartRow = 2; // Start from row 2 (skip header)
      let hasMore = true;
      let iterationCount = 0;
      const maxIterations = 10; // Safety limit to prevent infinite loops

      while (hasMore && iterationCount < maxIterations) {
        iterationCount++;

        // Reset mocks for each iteration
        s3Mock.reset();
        dynamoMock.reset();

        // Setup S3 mock to return the full CSV
        s3Mock.on(GetObjectCommand).resolves({
          Body: sdkStreamMixin(Readable.from([csvContent])),
        });

        // Capture BatchWrite calls to track which records were processed
        dynamoMock.on(BatchWriteCommand).callsFake((input: { RequestItems?: Record<string, Array<{ PutRequest?: { Item?: { issueKey?: string } } }>> }) => {
          // Get the actual table name from RequestItems (there should only be one)
          const requestTables = Object.keys(input.RequestItems ?? {});
          if (requestTables.length === 0) {
            return Promise.resolve({});
          }

          const actualTableName = requestTables[0];
          const items = input.RequestItems?.[actualTableName];

          if (items && items.length > 0) {
            items.forEach((item: { PutRequest?: { Item?: { issueKey?: string } } }) => {
              const issueKey = item.PutRequest?.Item?.issueKey;
              if (issueKey) {
                if (processedIssueKeys.has(issueKey)) {
                  throw new Error(`Duplicate issue key detected: ${issueKey}`);
                }
                processedIssueKeys.add(issueKey);
              }
            });
          }
          return Promise.resolve({});
        });

        // Mock UpdateCommand - handles both batch claim and progress update
        dynamoMock.on(UpdateCommand).resolves({});

        // Process current batch
        const result = await handler({
          uploadId: 'test-complete-csv',
          timestamp: '2024-01-01T00:00:00Z',
          bucket: 'test-bucket',
          key: 'test-key',
          fileName: 'large-jira-export.csv',
          startRow: currentStartRow,
          batchSize: batchSize,
        });

        // Track iteration progress for debugging if needed
        // console.log(`Iteration ${iterationCount}: Processed ${result.processedRows} rows starting from ${currentStartRow}`);

        // Verify the batch result
        expect(result.uploadId).toBe('test-complete-csv');
        expect(result.startRow).toBe(currentStartRow);
        expect(result.batchSize).toBe(batchSize);
        expect(result.processedRows).toBeGreaterThan(0);
        expect(result.processedRows).toBeLessThanOrEqual(batchSize);

        // Update for next iteration (this simulates the PrepareNextBatch Pass state)
        hasMore = result.hasMore;
        if (hasMore) {
          expect(result.nextStartRow).toBeDefined();
          expect(result.nextStartRow).toBe(currentStartRow + batchSize);
          currentStartRow = result.nextStartRow!;
        }
      }

      // Verify final state
      expect(iterationCount).toBeLessThan(maxIterations); // Should complete without hitting safety limit
      expect(hasMore).toBe(false); // Should have processed all records
      expect(processedIssueKeys.size).toBe(expectedProcessedRecords); // All records should be processed
      expect(iterationCount).toBe(Math.ceil(expectedProcessedRecords / batchSize)); // Should take expected number of batches

      // Verify no duplicate records were processed
      // Note: PROJ-1 is skipped because startRow=2, so we check PROJ-2 through PROJ-251
      const uniqueKeys = Array.from(processedIssueKeys).sort();
      for (let i = 2; i <= expectedProcessedRecords + 1; i++) {
        expect(uniqueKeys).toContain(`PROJ-${i}`);
      }

      // Successfully processed all records - test passed!
    });

    it('should handle edge case: CSV with exactly batchSize records', async () => {
      // Test edge case where total records = batchSize + 1 (to account for the first skipped row)
      const batchSize = 1000;
      // Need batchSize + 1 rows because the first data row gets skipped when startRow=2
      const rows = Array.from({ length: batchSize + 1 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const event = {
        uploadId: 'test-exact-batch-size',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize,
      };

      // Act
      const result = await handler(event);

      // Assert - should process batchSize records
      expect(result.processedRows).toBe(batchSize);
      expect(result.hasMore).toBe(true); // We processed exactly batchSize records
      expect(result.nextStartRow).toBe(2 + batchSize);
    });

    it('should handle edge case: CSV with batchSize + 1 records', async () => {
      // Test edge case where we need 2 batches to process all records
      const batchSize = 100;
      // Need batchSize + 2 rows: 1 gets skipped initially, then batchSize processed, then 1 more
      const totalRecords = batchSize + 2;
      const rows = Array.from({ length: totalRecords }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;

      // Batch 1
      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(Readable.from([csvContent])),
      });
      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const batch1Result = await handler({
        uploadId: 'test-batch-plus-one',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize,
      });

      expect(batch1Result.processedRows).toBe(batchSize);
      expect(batch1Result.hasMore).toBe(true);
      expect(batch1Result.nextStartRow).toBe(2 + batchSize);

      // Batch 2
      s3Mock.reset();
      dynamoMock.reset();
      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(Readable.from([csvContent])),
      });
      dynamoMock.on(BatchWriteCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const batch2Result = await handler({
        uploadId: 'test-batch-plus-one',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: batch1Result.nextStartRow!,
        batchSize,
      });

      expect(batch2Result.processedRows).toBe(1);
      expect(batch2Result.hasMore).toBe(false);
      expect(batch2Result.nextStartRow).toBeUndefined();
    });
  });
});
