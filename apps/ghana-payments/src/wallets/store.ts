import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';

const TABLE = (): string => process.env.WALLETS_TABLE ?? '';

export interface Wallet {
  phone: string;
  balance_pesewas: number;
  updated_at: string;
}

export async function getWallet(phone: string): Promise<Wallet | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE(), Key: { phone } }));
  return res.Item as Wallet | undefined;
}

/** Simulated top-up (D7) — creates the wallet on first use. */
export async function topUp(phone: string, amountPesewas: number): Promise<Wallet> {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { phone },
      UpdateExpression: 'ADD balance_pesewas :amt SET updated_at = :now',
      ExpressionAttributeValues: { ':amt': amountPesewas, ':now': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    })
  );
  return res.Attributes as Wallet;
}

/**
 * Atomic check-and-debit at initiation (ADR-9). Returns false on insufficient funds
 * (or missing wallet) — the caller returns INSUFFICIENT_FUNDS and creates no payment.
 */
export async function debit(phone: string, amountPesewas: number): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { phone },
        UpdateExpression: 'ADD balance_pesewas :neg SET updated_at = :now',
        ConditionExpression: 'balance_pesewas >= :amt',
        ExpressionAttributeValues: {
          ':neg': -amountPesewas,
          ':amt': amountPesewas,
          ':now': new Date().toISOString(),
        },
      })
    );
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/** Credit-back on FAILED/EXPIRED (ADR-9). Exactly-once is enforced by the caller via the ledger marker. */
export async function credit(phone: string, amountPesewas: number): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { phone },
      UpdateExpression: 'ADD balance_pesewas :amt SET updated_at = :now',
      ExpressionAttributeValues: { ':amt': amountPesewas, ':now': new Date().toISOString() },
    })
  );
}
