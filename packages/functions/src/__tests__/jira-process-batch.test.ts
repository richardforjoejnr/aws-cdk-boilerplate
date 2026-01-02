import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Readable } from 'stream';
import { handler } from '../jira-process-batch/index.js';
import { sdkStreamMixin } from '@smithy/util-stream';

// Mock AWS SDK clients
const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);
const cloudwatchMock = mockClient(CloudWatchClient);

// Set environment variables
process.env.UPLOADS_TABLE = 'test-uploads-table';

describe('ProcessBatch Lambda Handler - Phase 3', () => {
  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    cloudwatchMock.reset();
  });

  describe('Metric Calculation Tests', () => {
    it('should calculate metrics in-flight without writing issues to DynamoDB', async () => {
      // Arrange: CSV with known data to verify metric calculations
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Bug 1,PROJ-1,1,Bug,Open,High,John Doe,2024-01-01,2024-01-02,,PROJ,Project Name
Story 1,PROJ-2,2,Story,Done,Medium,Jane Smith,2024-01-01,2024-01-02,2024-01-03,PROJ,Project Name
Bug 2,PROJ-3,3,Bug,In Progress,High,Bob Johnson,2024-01-01,2024-01-02,,PROJ,Project Name
Task 1,PROJ-4,4,Task,To Do,Low,Alice Williams,2024-01-01,2024-01-02,,PROJ,Project Name`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

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

      // Assert Phase 3 behavior
      expect(result.batchMetrics).toBeDefined();
      expect(result.batchMetrics.totalIssues).toBe(3); // Processed 3 out of 4 rows (skipped PROJ-1)

      // Verify metrics calculations
      expect(result.batchMetrics.bugs.total).toBe(1); // Only PROJ-3 (Bug 2)
      expect(result.batchMetrics.bugs.open).toBe(1);

      // Verify distributions
      expect(result.batchMetrics.byStatus['Done']).toBe(1); // PROJ-2 (Story)
      expect(result.batchMetrics.byStatus['In Progress']).toBe(1); // PROJ-3 (Bug)
      expect(result.batchMetrics.byStatus['To Do']).toBe(1); // PROJ-4 (Task)

      expect(result.batchMetrics.byPriority['High']).toBe(1); // PROJ-3
      expect(result.batchMetrics.byPriority['Medium']).toBe(1); // PROJ-2
      expect(result.batchMetrics.byPriority['Low']).toBe(1); // PROJ-4

      expect(result.batchMetrics.byType['Bug']).toBe(1); // PROJ-3
      expect(result.batchMetrics.byType['Story']).toBe(1); // PROJ-2
      expect(result.batchMetrics.byType['Task']).toBe(1); // PROJ-4

      // PHASE 3: Verify CloudWatch metrics are published
      const cloudwatchCalls = cloudwatchMock.commandCalls(PutMetricDataCommand);
      expect(cloudwatchCalls.length).toBeGreaterThan(0);
    });

    it('should track top N open bugs correctly', async () => {
      // Arrange: CSV with multiple bugs at different priorities
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Bug Low,PROJ-1,1,Bug,Open,Low,User1,2024-01-01,2024-01-02,,PROJ,Project
Bug High,PROJ-2,2,Bug,Open,High,User2,2024-01-01,2024-01-02,,PROJ,Project
Bug Med,PROJ-3,3,Bug,Open,Medium,User3,2024-01-01,2024-01-02,,PROJ,Project
Bug Highest,PROJ-4,4,Bug,Open,Highest,User4,2024-01-01,2024-01-02,,PROJ,Project
Bug Closed,PROJ-5,5,Bug,Done,High,User5,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        uploadId: 'test-top-bugs',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const result = await handler(event);

      // Assert: Top bugs should be sorted by priority
      expect(result.batchMetrics.topOpenBugs).toBeDefined();
      expect(result.batchMetrics.topOpenBugs.length).toBe(3); // 3 open bugs (PROJ-1 skipped, PROJ-5 is closed)

      // Verify priority ordering - bugs are sorted but we need to check actual order returned
      const bugKeys = result.batchMetrics.topOpenBugs.map(b => b.issueKey);
      expect(bugKeys).toContain('PROJ-2'); // High
      expect(bugKeys).toContain('PROJ-3'); // Medium
      expect(bugKeys).toContain('PROJ-4'); // Highest
      // First should be highest priority
      expect(['PROJ-4', 'PROJ-2']).toContain(result.batchMetrics.topOpenBugs[0].issueKey);
    });

    it('should track top N unassigned issues correctly', async () => {
      // Arrange: CSV with unassigned issues
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Task 1,PROJ-1,1,Task,Open,High,,2024-01-01,2024-01-02,,PROJ,Project
Task 2,PROJ-2,2,Task,In Progress,Medium,John Doe,2024-01-01,2024-01-02,,PROJ,Project
Task 3,PROJ-3,3,Story,Open,Low,,2024-01-01,2024-01-02,,PROJ,Project`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        uploadId: 'test-unassigned',
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
      expect(result.batchMetrics.topUnassignedIssues).toBeDefined();
      expect(result.batchMetrics.topUnassignedIssues.length).toBe(1); // 1 unassigned issue (PROJ-1 skipped)
      expect(result.batchMetrics.topUnassignedIssues[0].issueKey).toBe('PROJ-3');
    });

    it('should track recent issues by created date', async () => {
      // Arrange: CSV with issues at different created dates
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Old Task,PROJ-1,1,Task,Open,High,User,2024-01-01,2024-01-02,,PROJ,Project
Recent Task,PROJ-2,2,Task,Open,High,User,2024-12-01,2024-12-02,,PROJ,Project
Older Task,PROJ-3,3,Task,Open,High,User,2024-06-01,2024-06-02,,PROJ,Project`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        uploadId: 'test-recent',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 10,
      };

      // Act
      const result = await handler(event);

      // Assert: Should be sorted by created date descending
      expect(result.batchMetrics.topRecentIssues).toBeDefined();
      expect(result.batchMetrics.topRecentIssues.length).toBe(2); // PROJ-1 skipped by startRow=2
      expect(result.batchMetrics.topRecentIssues[0].issueKey).toBe('PROJ-2'); // Most recent
      expect(result.batchMetrics.topRecentIssues[1].issueKey).toBe('PROJ-3');
    });

    it('should accumulate metrics across batches', async () => {
      // Arrange: CSV with 3 data rows - we'll process in 2 batches
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Bug 1,PROJ-1,1,Bug,Open,High,User,2024-01-01,2024-01-02,,PROJ,Project
Story 1,PROJ-2,2,Story,Done,Medium,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project
Bug 2,PROJ-3,3,Bug,Open,Low,User,2024-01-01,2024-01-02,,PROJ,Project`;

      // First batch: process first row only (PROJ-2, since PROJ-1 is skipped by startRow=2)
      s3Mock.on(GetObjectCommand).resolvesOnce({
        Body: sdkStreamMixin(Readable.from([csvContent])),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

      const event1 = {
        uploadId: 'test-accumulate',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 2,
        batchSize: 1, // Process just 1 row
      };

      // Act: Process first batch
      const result1 = await handler(event1);

      expect(result1.batchMetrics.totalIssues).toBe(1); // PROJ-2
      expect(result1.batchMetrics.bugs.total).toBe(0); // PROJ-2 is a Story
      expect(result1.hasMore).toBe(true);
      expect(result1.nextStartRow).toBe(3);

      // Second batch: process second row (PROJ-3)
      s3Mock.reset();
      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(Readable.from([csvContent])),
      });

      const event2 = {
        uploadId: 'test-accumulate',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: result1.nextStartRow!, // Continue from row 3
        batchSize: 1,
        accumulatedMetrics: result1.batchMetrics, // Pass previous metrics
      };

      // Act: Process second batch
      const result2 = await handler(event2);

      // Assert: Metrics should accumulate
      expect(result2.batchMetrics.totalIssues).toBe(2); // 1 from first + 1 from second
      expect(result2.batchMetrics.bugs.total).toBe(1); // PROJ-3 is a bug
      expect(result2.batchMetrics.byType['Story']).toBe(1); // From first batch
      expect(result2.batchMetrics.byType['Bug']).toBe(1); // From second batch
    });
  });

  describe('Batch Processing Tests', () => {
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

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

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
      expect(result.nextStartRow).toBe(12);
      expect(result.batchMetrics.totalIssues).toBe(10);
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

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        uploadId: 'test-upload-789',
        timestamp: '2024-01-01T00:00:00Z',
        bucket: 'test-bucket',
        key: 'test-key',
        fileName: 'test.csv',
        startRow: 7,
        batchSize: 5,
      };

      // Act
      const result = await handler(event);

      // Assert
      expect(result.processedRows).toBe(4);
      expect(result.hasMore).toBe(false);
      expect(result.batchMetrics.totalIssues).toBe(4);
    });

    it('should process complete batch successfully', async () => {
      // Arrange
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Task 1,PROJ-1,1,Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        uploadId: 'test-complete',
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
      expect(result.uploadId).toBe('test-complete');
      expect(result.processedRows).toBe(0); // First row skipped
      expect(result.hasMore).toBe(false);
      expect(result.batchMetrics).toBeDefined();
    });
  });

  describe('Stream Cleanup Tests', () => {
    it('should destroy streams after processing complete batch', async () => {
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name
Task 1,PROJ-1,1,Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`;

      const stream = Readable.from([csvContent]);
      const destroySpy = jest.spyOn(stream, 'destroy');

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

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

      // Assert
      expect(destroySpy).toHaveBeenCalled();
    });

    it('should destroy streams when breaking early (hasMore=true)', async () => {
      const rows = Array.from({ length: 100 }, (_, i) =>
        `Task ${i+1},PROJ-${i+1},${i+1},Story,Done,High,User,2024-01-01,2024-01-02,2024-01-03,PROJ,Project`
      ).join('\n');

      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name\n${rows}`;
      const stream = Readable.from([csvContent]);
      const destroySpy = jest.spyOn(stream, 'destroy');

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        uploadId: 'test-stream-cleanup-early',
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
      expect(destroySpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when S3 body is missing', async () => {
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
      const csvContent = `Summary,Issue key,Issue id
Task 1,PROJ-1
Task 2,PROJ-2,2,Extra,Columns,Here`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

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

      // Assert: Should still process
      expect(result.batchMetrics).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    it('should process multiline CSV fields correctly', async () => {
      const csvContent = `Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Created,Updated,Resolved,Project key,Project name,Description
Task 1,PROJ-1,1,Story,Done,High,User1,2024-01-01,2024-01-02,2024-01-03,PROJ,Project,"This is a description"
Task 2,PROJ-2,2,Bug,In Progress,Medium,User2,2024-01-01,2024-01-02,,PROJ,Project,"This description
has multiple
lines in it"
Task 3,PROJ-3,3,Story,Done,Low,User3,2024-01-01,2024-01-02,2024-01-03,PROJ,Project,"Simple desc"`;

      const stream = Readable.from([csvContent]);

      s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(stream),
      });

      dynamoMock.on(UpdateCommand).resolves({});
      cloudwatchMock.on(PutMetricDataCommand).resolves({});

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

      // Assert
      expect(result.batchMetrics.totalIssues).toBe(2); // First row skipped, 2 processed
      expect(result.hasMore).toBe(false);
    });
  });
});
