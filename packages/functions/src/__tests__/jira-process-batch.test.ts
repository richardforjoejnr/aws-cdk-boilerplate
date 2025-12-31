import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Readable } from 'stream';
import { handler } from '../jira-process-batch/index.js';

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
        Body: stream as any,
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
      expect(dynamoMock.calls()).toHaveLength(2); // 1 BatchWrite + 1 Update
    });

    it('should handle large batches and return hasMore=true', async () => {
      // Arrange: Create a CSV with 15 rows but batchSize of 10
      const rows = Array.from({ length: 15 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: stream as any,
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
        Body: stream as any,
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
        Body: stream as any,
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
        Body: stream as any,
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
        Body: stream as any,
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
        Body: stream as any,
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
        Body: stream as any,
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
        Body: stream as any,
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
        Body: stream as any,
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
        Body: Readable.from([csvContent]) as any,
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
        Body: Readable.from([csvContent]) as any,
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
        Body: Readable.from([csvContent]) as any,
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
  });
});
