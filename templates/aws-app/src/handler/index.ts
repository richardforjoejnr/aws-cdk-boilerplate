import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = (): string => process.env.TABLE_NAME ?? '';

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Minimal REST handler — a starting point to extend:
 *   GET  /            health check
 *   POST /items       create an item { name, ... }
 *   GET  /items       list items
 *   GET  /items/{id}  fetch one item
 *
 * Routes on `event.path` (the real request path) — the stack uses a proxy
 * integration, so `event.resource` is always `/{proxy+}`.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = (event.path || '/').replace(/\/+$/, '') || '/';

    if (method === 'GET' && path === '/') {
      return json(200, { ok: true, app: '__APP_NAME__', stage: process.env.STAGE });
    }

    if (method === 'POST' && path === '/items') {
      const input = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
      const item = { pk: `item#${randomUUID()}`, ...input, created_at: new Date().toISOString() };
      await ddb.send(new PutCommand({ TableName: TABLE(), Item: item }));
      return json(201, item);
    }

    if (method === 'GET' && path === '/items') {
      const res = await ddb.send(new ScanCommand({ TableName: TABLE(), Limit: 100 }));
      return json(200, { items: res.Items ?? [] });
    }

    const itemMatch = /^\/items\/([^/]+)$/.exec(path);
    if (method === 'GET' && itemMatch) {
      const res = await ddb.send(new GetCommand({ TableName: TABLE(), Key: { pk: `item#${itemMatch[1]}` } }));
      return res.Item ? json(200, res.Item) : json(404, { error: 'not_found' });
    }

    return json(404, { error: 'route_not_found', method, path });
  } catch (err) {
    console.error('handler error', err);
    return json(500, { error: 'internal_error' });
  }
};
