import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';
import { confirmPayment, expirePayment, markCreditedBack, markPlayed } from './ledger.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);

process.env.PAYMENTS_TABLE = 'test-payments';

function cancelled(reasons: Array<string | null>): Error {
  return Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: reasons.map((code) => (code ? { Code: code } : { Code: 'None' })),
  });
}

beforeEach(() => ddbMock.reset());

describe('confirmPayment (ADR-4a + F-1)', () => {
  const input = {
    paymentId: 'pay_1',
    providerTxnId: 'mocktxn-abc',
    toStatus: 'SUCCESS' as const,
    rawPayloadRef: 's3://inbox/x.json',
  };

  it('applies the transition and appends the confirmed event', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(GetCommand).resolves({
      Item: { payment_id: 'pay_1', sk: 'META', status: 'SUCCESS', merchant_id: 'mer_1', amount_pesewas: 2000 },
    });
    const result = await confirmPayment(input);
    expect(result.outcome).toBe('applied');
    const evtPut = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(evtPut.Item?.sk).toMatch(/^EVT#/);
    expect(evtPut.Item?.event_type).toBe('PAYMENT_CONFIRMED');
  });

  it('returns duplicate when the idempotency item already exists — no event, no rethrow', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled(['ConditionalCheckFailed', null]));
    const result = await confirmPayment(input);
    expect(result.outcome).toBe('duplicate');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('records ANOMALY_LATE_CALLBACK when META is already terminal (F-1)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled([null, 'ConditionalCheckFailed']));
    ddbMock.on(GetCommand).resolves({ Item: { payment_id: 'pay_1', status: 'EXPIRED' } });
    ddbMock.on(PutCommand).resolves({});
    const result = await confirmPayment(input);
    expect(result.outcome).toBe('late_callback');
    const anomaly = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(anomaly.Item?.event_type).toBe('ANOMALY_LATE_CALLBACK');
    expect(anomaly.Item?.current_status).toBe('EXPIRED');
  });
});

describe('expirePayment (ADR-5)', () => {
  it('returns false when a callback won the race (condition failed)', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    expect(await expirePayment('pay_1')).toBe(false);
  });

  it('expires an open payment and appends the event', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    expect(await expirePayment('pay_1')).toBe(true);
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item?.event_type).toBe(
      'PAYMENT_EXPIRED'
    );
  });
});

describe('markCreditedBack (exactly-once credit-back)', () => {
  it('is false on second attempt', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    expect(await markCreditedBack('pay_1')).toBe(false);
  });
});

describe('markPlayed (device audio confirmation, exactly-once)', () => {
  const meta = {
    payment_id: 'pay_1',
    sk: 'META',
    status: 'SUCCESS',
    created_at: '2026-08-06T10:00:00.000Z',
    confirmed_at: '2026-08-06T10:00:02.000Z',
    announced_at: '2026-08-06T10:00:02.500Z',
    played_at: '2026-08-06T10:00:03.500Z',
    played_network_type: '4G',
  };

  it('sets played_at once, appends DEVICE_PLAYED, and returns the updated record', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: meta });
    ddbMock.on(PutCommand).resolves({});
    const record = await markPlayed('pay_1', { deviceId: 'dev_1', networkType: '4G' });
    expect(record).toMatchObject({ played_at: meta.played_at });

    const upd = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(upd.ConditionExpression).toContain('attribute_not_exists(played_at)');
    expect(upd.ConditionExpression).toContain('attribute_exists(announced_at)');
    expect(upd.ReturnValues).toBe('ALL_NEW');

    const evt = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<string, unknown>;
    expect(evt.event_type).toBe('DEVICE_PLAYED');
    expect(evt.device_id).toBe('dev_1');
    expect(evt.network_type).toBe('4G');
  });

  it('returns undefined on a duplicate ack (played_at already set)', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    expect(await markPlayed('pay_1', { deviceId: 'dev_1' })).toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
