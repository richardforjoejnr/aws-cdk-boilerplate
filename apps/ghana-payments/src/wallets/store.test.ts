import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';
import { debit, topUp } from './store.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
process.env.WALLETS_TABLE = 'test-wallets';

beforeEach(() => ddbMock.reset());

describe('wallet debit (ADR-9 atomic check-and-debit)', () => {
  it('returns false on insufficient funds (condition failed) — caller creates no payment', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    expect(await debit('hash1', 5000)).toBe(false);
  });

  it('debits with a balance >= amount condition', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    expect(await debit('hash1', 2000)).toBe(true);
    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ConditionExpression).toContain('balance_pesewas >= :amt');
    expect(input.ExpressionAttributeValues?.[':neg']).toBe(-2000);
  });
});

describe('wallet topUp (D7)', () => {
  it('adds simulated funds and returns the new balance', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { phone: 'hash1', balance_pesewas: 7000 } });
    const wallet = await topUp('hash1', 7000);
    expect(wallet.balance_pesewas).toBe(7000);
  });
});
