import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { handler } from './webhook.js';
import type { MockCallbackBody } from './mock-provider.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const busMock = mockClient(EventBridgeClient);

process.env.PAYMENTS_TABLE = 'test-payments';
process.env.WEBHOOK_INBOX_BUCKET = 'test-inbox';
process.env.EVENT_BUS_NAME = 'test-bus';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;

interface WebhookResponse {
  received?: boolean;
  duplicate?: boolean;
  late?: boolean;
  unknown_payment?: boolean;
}
interface ErrorResponse {
  error: { code: string };
}

function cancelled(reasons: Array<string | null>): Error {
  return Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: reasons.map((code) => (code ? { Code: code } : { Code: 'None' })),
  });
}

const callback = (overrides: Partial<MockCallbackBody> = {}): MockCallbackBody => ({
  financialTransactionId: 'mocktxn-abc',
  externalId: 'pay_1',
  amount: '20.00',
  currency: 'GHS',
  status: 'SUCCESSFUL',
  payer: { partyIdType: 'MSISDN', partyId: '0244000000' },
  ...overrides,
});

const event = (body: string | null, provider = 'mock'): APIGatewayProxyEvent =>
  ({ pathParameters: { provider }, body }) as unknown as APIGatewayProxyEvent;

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  busMock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  busMock.on(PutEventsCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
});

describe('webhook receiver (§9 flow, ADR-4a)', () => {
  it('writes the raw body to the S3 inbox BEFORE the ledger transaction (Appendix B)', async () => {
    const order: string[] = [];
    s3Mock.on(PutObjectCommand).callsFake(() => {
      order.push('s3-inbox');
      return {};
    });
    ddbMock.on(TransactWriteCommand).callsFake(() => {
      order.push('ledger');
      return {};
    });
    ddbMock.on(GetCommand).resolves({
      Item: { payment_id: 'pay_1', sk: 'META', status: 'SUCCESS', merchant_id: 'mer_1', amount_pesewas: 2000 },
    });

    const res = await handler(event(JSON.stringify(callback())));
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['s3-inbox', 'ledger']);
    const s3Input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(s3Input.Bucket).toBe('test-inbox');
    expect(s3Input.Key).toMatch(/^webhooks\/mock\/\d{4}-\d{2}-\d{2}\/pay_1-/);
    expect(s3Input.Body).toBe(JSON.stringify(callback())); // raw, uninterpreted
  });

  it('publishes payment.confirmed exactly once on a fresh SUCCESS transition', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({
      Item: { payment_id: 'pay_1', sk: 'META', status: 'SUCCESS', merchant_id: 'mer_1', amount_pesewas: 2000 },
    });
    const res = await handler(event(JSON.stringify(callback())));
    expect(res.statusCode).toBe(200);
    expect(parse<WebhookResponse>(res)).toEqual({ received: true });

    const publishes = busMock.commandCalls(PutEventsCommand);
    expect(publishes).toHaveLength(1);
    const entry = publishes[0].args[0].input.Entries?.[0];
    expect(entry?.DetailType).toBe('payment.confirmed');
    const detail = JSON.parse(entry?.Detail ?? '{}') as { merchant_id: string; amount: number };
    expect(detail.merchant_id).toBe('mer_1'); // filled from the ledger, not the callback
    expect(detail.amount).toBe(2000); // integer pesewas
  });

  it('publishes payment.failed for a FAILED callback', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({
      Item: { payment_id: 'pay_1', sk: 'META', status: 'FAILED', merchant_id: 'mer_1', amount_pesewas: 1300 },
    });
    await handler(event(JSON.stringify(callback({ status: 'FAILED', reason: 'PAYER_LIMIT_REACHED', amount: '13.00' }))));
    const entry = busMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries?.[0];
    expect(entry?.DetailType).toBe('payment.failed');
  });

  it('duplicate callback -> 200 {duplicate:true}, inbox still written, NOTHING published', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled(['ConditionalCheckFailed', null]));
    const res = await handler(event(JSON.stringify(callback())));
    expect(res.statusCode).toBe(200);
    expect(parse<WebhookResponse>(res).duplicate).toBe(true);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1); // audit trail kept
    expect(busMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('late callback (terminal META, F-1) -> 200 {late:true}, no publish', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled([null, 'ConditionalCheckFailed']));
    ddbMock.on(GetCommand).resolves({ Item: { payment_id: 'pay_1', status: 'EXPIRED' } });
    const res = await handler(event(JSON.stringify(callback())));
    expect(res.statusCode).toBe(200);
    expect(parse<WebhookResponse>(res).late).toBe(true);
    expect(busMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('unknown payment -> 200 {unknown_payment:true} (no useful retry), no publish', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled([null, 'ConditionalCheckFailed']));
    ddbMock.on(GetCommand).resolves({}); // META never existed
    const res = await handler(event(JSON.stringify(callback())));
    expect(res.statusCode).toBe(200);
    expect(parse<WebhookResponse>(res).unknown_payment).toBe(true);
    expect(busMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });
});

describe('webhook input validation', () => {
  it('401s an unknown provider (signature seam, ADR-8)', async () => {
    const res = await handler(event(JSON.stringify(callback()), 'stranger'));
    expect(res.statusCode).toBe(401);
    expect(parse<ErrorResponse>(res).error.code).toBe('UNKNOWN_PROVIDER');
  });

  it('400s a missing body', async () => {
    const res = await handler(event(null));
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('MISSING_BODY');
  });

  it('400s non-JSON body', async () => {
    const res = await handler(event('not-json{'));
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_JSON');
  });

  it('400s a callback missing required fields — and never touches S3 or the ledger', async () => {
    const res = await handler(event(JSON.stringify({ amount: '20.00' })));
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_CALLBACK');
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});
