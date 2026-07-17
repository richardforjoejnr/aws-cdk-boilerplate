import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventBridgeEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import type { PaymentEvent } from '../shared/types.js';
import { handler } from './credit-back.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
const busMock = mockClient(EventBridgeClient);

process.env.PAYMENTS_TABLE = 'test-payments';
process.env.WALLETS_TABLE = 'test-wallets';
process.env.EVENT_BUS_NAME = 'test-bus';

const busEvent = (
  detailType: 'payment.failed' | 'payment.expired' = 'payment.failed'
): EventBridgeEvent<'payment.failed' | 'payment.expired', PaymentEvent> =>
  ({
    'detail-type': detailType,
    detail: { payment_id: 'pay_1' },
  }) as unknown as EventBridgeEvent<'payment.failed' | 'payment.expired', PaymentEvent>;

const meta = {
  payment_id: 'pay_1',
  sk: 'META',
  status: 'FAILED',
  payer_phone_hash: 'hash1',
  amount_pesewas: 1300,
};

const walletUpdates = () =>
  ddbMock
    .commandCalls(UpdateCommand)
    .filter((c) => c.args[0].input.TableName === 'test-wallets')
    .map((c) => c.args[0].input);

beforeEach(() => {
  ddbMock.reset();
  busMock.reset();
  busMock.on(PutEventsCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
});

describe('credit-back (ADR-9, exactly-once via credited_back_at marker)', () => {
  it('credits the wallet once and publishes wallet.credited', async () => {
    ddbMock.on(GetCommand).resolves({ Item: meta });
    await handler(busEvent());

    const marker = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => c.args[0].input.TableName === 'test-payments');
    expect(marker?.args[0].input.ConditionExpression).toContain(
      'attribute_not_exists(credited_back_at)'
    );

    const credits = walletUpdates();
    expect(credits).toHaveLength(1);
    expect(credits[0].Key?.phone).toBe('hash1');
    expect(credits[0].ExpressionAttributeValues?.[':amt']).toBe(1300);

    const evt = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(evt?.event_type).toBe('WALLET_CREDITED_BACK');

    const entry = busMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries?.[0];
    expect(entry?.DetailType).toBe('wallet.credited');
    const detail = JSON.parse(entry?.Detail ?? '{}') as { reason: string; amount_pesewas: number };
    expect(detail.reason).toBe('payment.failed');
    expect(detail.amount_pesewas).toBe(1300);
  });

  it('marker already taken (duplicate delivery) -> NO wallet movement, NO publish', async () => {
    ddbMock.on(GetCommand).resolves({ Item: meta });
    ddbMock
      .on(UpdateCommand, { TableName: 'test-payments' })
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    await handler(busEvent('payment.expired'));
    expect(walletUpdates()).toHaveLength(0);
    expect(busMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('missing payment is tolerated (logged, no throw, no wallet movement)', async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(handler(busEvent())).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(busMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });
});
