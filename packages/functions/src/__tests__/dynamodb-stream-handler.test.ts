import { handler } from '../dynamodb-stream-handler/index.js';
import type { DynamoDBStreamEvent, Context } from 'aws-lambda';

describe('DynamoDB Stream Handler', () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-stream-handler',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test',
    logStreamName: '2024/01/01/[$LATEST]test',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  it('should process INSERT events', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: '1',
          eventName: 'INSERT',
          eventVersion: '1.1',
          eventSource: 'aws:dynamodb',
          awsRegion: 'us-east-1',
          dynamodb: {
            Keys: {
              pk: { S: 'test-pk' },
              sk: { S: 'test-sk' },
            },
            NewImage: {
              pk: { S: 'test-pk' },
              sk: { S: 'test-sk' },
              name: { S: 'Test Item' },
            },
            SequenceNumber: '111',
            SizeBytes: 100,
            StreamViewType: 'NEW_AND_OLD_IMAGES',
          },
          eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2024-01-01',
        },
      ],
    };

    await expect(handler(event, mockContext)).resolves.toBeUndefined();
  });

  it('should process MODIFY events', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: '2',
          eventName: 'MODIFY',
          eventVersion: '1.1',
          eventSource: 'aws:dynamodb',
          awsRegion: 'us-east-1',
          dynamodb: {
            Keys: {
              pk: { S: 'test-pk' },
              sk: { S: 'test-sk' },
            },
            OldImage: {
              pk: { S: 'test-pk' },
              sk: { S: 'test-sk' },
              name: { S: 'Old Name' },
            },
            NewImage: {
              pk: { S: 'test-pk' },
              sk: { S: 'test-sk' },
              name: { S: 'New Name' },
            },
            SequenceNumber: '222',
            SizeBytes: 150,
            StreamViewType: 'NEW_AND_OLD_IMAGES',
          },
          eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2024-01-01',
        },
      ],
    };

    await expect(handler(event, mockContext)).resolves.toBeUndefined();
  });

  it('should process REMOVE events', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: '3',
          eventName: 'REMOVE',
          eventVersion: '1.1',
          eventSource: 'aws:dynamodb',
          awsRegion: 'us-east-1',
          dynamodb: {
            Keys: {
              pk: { S: 'test-pk' },
              sk: { S: 'test-sk' },
            },
            OldImage: {
              pk: { S: 'test-pk' },
              sk: { S: 'test-sk' },
              name: { S: 'Deleted Item' },
            },
            SequenceNumber: '333',
            SizeBytes: 80,
            StreamViewType: 'NEW_AND_OLD_IMAGES',
          },
          eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2024-01-01',
        },
      ],
    };

    await expect(handler(event, mockContext)).resolves.toBeUndefined();
  });

  it('should process multiple records in a batch', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: '1',
          eventName: 'INSERT',
          eventVersion: '1.1',
          eventSource: 'aws:dynamodb',
          awsRegion: 'us-east-1',
          dynamodb: {
            Keys: { pk: { S: 'pk1' }, sk: { S: 'sk1' } },
            NewImage: { pk: { S: 'pk1' }, sk: { S: 'sk1' } },
            SequenceNumber: '111',
            SizeBytes: 50,
            StreamViewType: 'NEW_AND_OLD_IMAGES',
          },
          eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2024-01-01',
        },
        {
          eventID: '2',
          eventName: 'MODIFY',
          eventVersion: '1.1',
          eventSource: 'aws:dynamodb',
          awsRegion: 'us-east-1',
          dynamodb: {
            Keys: { pk: { S: 'pk2' }, sk: { S: 'sk2' } },
            OldImage: { pk: { S: 'pk2' }, sk: { S: 'sk2' } },
            NewImage: { pk: { S: 'pk2' }, sk: { S: 'sk2' } },
            SequenceNumber: '222',
            SizeBytes: 75,
            StreamViewType: 'NEW_AND_OLD_IMAGES',
          },
          eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2024-01-01',
        },
      ],
    };

    await expect(handler(event, mockContext)).resolves.toBeUndefined();
  });

  it('should handle empty records array', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [],
    };

    await expect(handler(event, mockContext)).resolves.toBeUndefined();
  });
});
