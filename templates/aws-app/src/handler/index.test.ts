import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from './index.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
process.env.TABLE_NAME = 'test-table';

const event = (over: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent =>
  ({ httpMethod: 'GET', path: '/', body: null, pathParameters: null, ...over }) as APIGatewayProxyEvent;

beforeEach(() => ddbMock.reset());

describe('__APP_NAME__ handler', () => {
  it('health check returns ok', async () => {
    const res = await handler(event({ httpMethod: 'GET', path: '/' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('POST /items creates an item', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(event({ httpMethod: 'POST', path: '/items', body: JSON.stringify({ name: 'widget' }) }));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('widget');
    expect(body.pk).toMatch(/^item#/);
  });

  it('GET /items lists items', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ pk: 'item#1', name: 'a' }] });
    const res = await handler(event({ httpMethod: 'GET', path: '/items' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toHaveLength(1);
  });

  it('GET /items/{id} fetches one', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { pk: 'item#abc', name: 'a' } });
    const res = await handler(event({ httpMethod: 'GET', path: '/items/abc' }));
    expect(res.statusCode).toBe(200);
  });

  it('unknown route returns 404', async () => {
    const res = await handler(event({ httpMethod: 'DELETE', path: '/nope' }));
    expect(res.statusCode).toBe(404);
  });
});
