import { handler } from '../hello-world/index.js';
import type { Context } from 'aws-lambda';

interface ResponseBody {
  greeting: string;
  timestamp: string;
  requestId: string;
}

describe('hello-world Lambda function', () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
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

  it('should return greeting with default name', async () => {
    const event = {};
    const result = await handler(event, mockContext);

    expect(result.statusCode).toBe(200);
    expect(result.message).toBe('Hello World!');

    const body = JSON.parse(result.body) as ResponseBody;
    expect(body.greeting).toBe('Hello World!');
    expect(body.requestId).toBe('test-request-id');
    expect(body.timestamp).toBeDefined();
  });

  it('should return greeting with custom name', async () => {
    const event = { name: 'Claude' };
    const result = await handler(event, mockContext);

    expect(result.statusCode).toBe(200);
    expect(result.message).toBe('Hello Claude!');

    const body = JSON.parse(result.body) as ResponseBody;
    expect(body.greeting).toBe('Hello Claude!');
  });

  it('should include timestamp in response', async () => {
    const event = { name: 'Test' };
    const result = await handler(event, mockContext);

    const body = JSON.parse(result.body) as ResponseBody;
    const timestamp = new Date(body.timestamp);

    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('should include request ID from context', async () => {
    const customContext = {
      ...mockContext,
      awsRequestId: 'custom-request-id-123',
    };

    const event = {};
    const result = await handler(event, customContext);

    const body = JSON.parse(result.body) as ResponseBody;
    expect(body.requestId).toBe('custom-request-id-123');
  });
});
