import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { createHandler, getHandler } from './handlers.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
process.env.MERCHANTS_TABLE = 'test-merchants';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;
interface ErrorResponse {
  error: { code: string };
}
const event = (
  body: Record<string, unknown> | null,
  pathParameters: Record<string, string> = {}
): APIGatewayProxyEvent =>
  ({ pathParameters, body: body ? JSON.stringify(body) : null }) as unknown as APIGatewayProxyEvent;

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
});

describe('merchant creation with payment methods', () => {
  it('defaults to MTN_MOMO when none are given', async () => {
    const res = await createHandler(event({ display_name: 'Ama Fruits', phone: '0200000000' }));
    expect(res.statusCode).toBe(201);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item?.payment_methods).toEqual(['MTN_MOMO']);
    expect(parse<{ payment_methods: string[] }>(res).payment_methods).toEqual(['MTN_MOMO']);
  });

  it('stores the chosen supported methods and de-duplicates them', async () => {
    const res = await createHandler(
      event({
        display_name: 'Kofi Store',
        phone: '0244000000',
        payment_methods: ['MTN_MOMO', 'CARD', 'MTN_MOMO'],
      })
    );
    expect(res.statusCode).toBe(201);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item?.payment_methods).toEqual(['MTN_MOMO', 'CARD']);
  });

  it('400s an unsupported payment method and writes nothing', async () => {
    const res = await createHandler(
      event({ display_name: 'X', phone: '0244000000', payment_methods: ['BITCOIN'] })
    );
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_PAYMENT_METHOD');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('never leaks the phone in plaintext (stored hashed only)', async () => {
    await createHandler(event({ display_name: 'X', phone: '0244123456' }));
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<string, unknown>;
    expect(item.phone_hash).toBeDefined();
    expect(JSON.stringify(item)).not.toContain('0244123456');
  });
});

describe('merchant GET exposes payment methods', () => {
  it('returns the stored payment_methods (and no PII hashes)', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        merchant_id: 'mer_1',
        sk: 'PROFILE',
        display_name: 'Kofi Store',
        phone_hash: 'deadbeef',
        business_category: 'food',
        payment_methods: ['MTN_MOMO', 'VODAFONE_CASH'],
        status: 'ACTIVE',
        kyc_level: 'NONE',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    });
    const res = await getHandler(event(null, { id: 'mer_1' }));
    expect(res.statusCode).toBe(200);
    const body = parse<Record<string, unknown>>(res);
    expect(body.payment_methods).toEqual(['MTN_MOMO', 'VODAFONE_CASH']);
    expect(body.phone_hash).toBeUndefined();
  });
});
