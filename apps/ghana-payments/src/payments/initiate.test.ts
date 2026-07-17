import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { _resetConfigCache } from '../shared/config.js';
import { handler } from './initiate.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);
const ssmMock = mockClient(SSMClient);
const busMock = mockClient(EventBridgeClient);

process.env.MERCHANTS_TABLE = 'test-merchants';
process.env.WALLETS_TABLE = 'test-wallets';
process.env.PAYMENTS_TABLE = 'test-payments';
process.env.MOCK_CALLBACK_QUEUE_URL = 'https://sqs.test/queue';
process.env.EVENT_BUS_NAME = 'test-bus';
process.env.STAGE = 'dev';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;

interface InitiateResponse {
  payment_id: string;
  status: string;
  amount_pesewas: number;
}
interface ErrorResponse {
  error: { code: string };
}

const event = (body: Record<string, unknown>): APIGatewayProxyEvent =>
  ({ pathParameters: {}, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;

const validBody = { merchant_id: 'mer_1', amount_pesewas: 2000, payer_phone: '0244000000' };

const activeMerchant = { merchant_id: 'mer_1', sk: 'PROFILE', status: 'ACTIVE' };

/** Wallet UpdateCommands: debit carries the balance condition, credit does not. */
const walletCalls = () =>
  ddbMock
    .commandCalls(UpdateCommand)
    .filter((c) => c.args[0].input.TableName === 'test-wallets')
    .map((c) => c.args[0].input);

beforeEach(() => {
  ddbMock.reset();
  sqsMock.reset();
  ssmMock.reset();
  busMock.reset();
  _resetConfigCache();
  ssmMock.on(GetParametersByPathCommand).resolves({
    Parameters: [{ Name: '/dev/ghana-payments/provider/active', Value: 'mock' }],
  });
  sqsMock.on(SendMessageCommand).resolves({});
  busMock.on(PutEventsCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
});

describe('payment initiation (ADR-9)', () => {
  it('404s an unknown merchant before touching the wallet', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(event(validBody));
    expect(res.statusCode).toBe(404);
    expect(parse<ErrorResponse>(res).error.code).toBe('MERCHANT_NOT_FOUND');
    expect(walletCalls()).toHaveLength(0);
  });

  it('409s a non-ACTIVE merchant — no debit, no payment record', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...activeMerchant, status: 'SUSPENDED' } });
    const res = await handler(event(validBody));
    expect(res.statusCode).toBe(409);
    expect(parse<ErrorResponse>(res).error.code).toBe('MERCHANT_NOT_ACTIVE');
    expect(walletCalls()).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('402s on insufficient funds AND creates no payment record (ADR-9)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: activeMerchant });
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await handler(event(validBody));
    expect(res.statusCode).toBe(402);
    expect(parse<ErrorResponse>(res).error.code).toBe('INSUFFICIENT_FUNDS');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0); // no META, no EVT
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0); // provider never called
    expect(busMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('happy path: debit -> ledger INITIATED -> provider -> payment.initiated published', async () => {
    ddbMock.on(GetCommand).resolves({ Item: activeMerchant });
    const res = await handler(event(validBody));
    expect(res.statusCode).toBe(201);
    const body = parse<InitiateResponse>(res);
    expect(body.status).toBe('INITIATED');
    expect(body.amount_pesewas).toBe(2000);
    expect(body.payment_id).toMatch(/^pay_/);

    const [debit] = walletCalls();
    expect(debit.ConditionExpression).toContain('balance_pesewas >= :amt');
    expect(debit.ExpressionAttributeValues?.[':neg']).toBe(-2000);

    const metaPut = ddbMock
      .commandCalls(PutCommand)
      .find((c) => c.args[0].input.Item?.sk === 'META');
    expect(metaPut?.args[0].input.ConditionExpression).toBe('attribute_not_exists(payment_id)');

    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
    const entry = busMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries?.[0];
    expect(entry?.DetailType).toBe('payment.initiated');
  });

  it('provider throws AFTER debit -> wallet credited straight back, rollback recorded, no publish', async () => {
    ddbMock.on(GetCommand).resolves({ Item: activeMerchant });
    sqsMock.on(SendMessageCommand).rejects(new Error('SQS is down'));

    const res = await handler(event(validBody));
    expect(res.statusCode).toBe(500);

    const wallet = walletCalls();
    expect(wallet).toHaveLength(2);
    // debit first (conditional), then unconditional credit of the same amount
    expect(wallet[0].ConditionExpression).toContain('balance_pesewas >= :amt');
    expect(wallet[1].ConditionExpression).toBeUndefined();
    expect(wallet[1].ExpressionAttributeValues?.[':amt']).toBe(2000);

    const eventTypes = ddbMock
      .commandCalls(PutCommand)
      .map((c) => c.args[0].input.Item?.event_type as string | undefined)
      .filter(Boolean);
    expect(eventTypes).toContain('INITIATION_ROLLED_BACK');

    expect(busMock.commandCalls(PutEventsCommand)).toHaveLength(0); // no payment.initiated
  });

  it('400s a non-integer pesewas amount (money is integer pesewas, never floats)', async () => {
    const res = await handler(event({ ...validBody, amount_pesewas: 20.5 }));
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_AMOUNT');
    expect(walletCalls()).toHaveLength(0);
  });
});
