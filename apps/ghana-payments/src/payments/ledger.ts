import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { ddb } from '../shared/clients.js';
import type { PaymentProvider, PaymentStatus } from '../shared/types.js';

const TABLE = (): string => process.env.PAYMENTS_TABLE ?? '';

/** Non-terminal statuses — the only ones a transition may leave (design-review F-1). */
const OPEN_STATUSES: PaymentStatus[] = ['INITIATED', 'PENDING'];

export interface PaymentRecord {
  payment_id: string;
  sk: 'META';
  merchant_id: string;
  payer_phone_hash: string;
  amount_pesewas: number;
  currency: 'GHS';
  provider: PaymentProvider;
  status: PaymentStatus;
  created_at: string;
  confirmed_at?: string;
  announced_at?: string;
  credited_back_at?: string;
  reason?: string;
}

export async function createPayment(input: {
  merchantId: string;
  payerPhoneHash: string;
  amountPesewas: number;
  provider: PaymentProvider;
}): Promise<PaymentRecord> {
  const record: PaymentRecord = {
    payment_id: `pay_${randomUUID()}`,
    sk: 'META',
    merchant_id: input.merchantId,
    payer_phone_hash: input.payerPhoneHash,
    amount_pesewas: input.amountPesewas,
    currency: 'GHS',
    provider: input.provider,
    status: 'INITIATED',
    created_at: new Date().toISOString(),
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE(),
      Item: record,
      ConditionExpression: 'attribute_not_exists(payment_id)',
    })
  );
  await appendEvent(record.payment_id, 'PAYMENT_INITIATED', { amount_pesewas: record.amount_pesewas });
  return record;
}

export async function getPayment(paymentId: string): Promise<PaymentRecord | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE(), Key: { payment_id: paymentId, sk: 'META' } })
  );
  return res.Item as PaymentRecord | undefined;
}

/** Append-only event history item (ADR-3). Never conditional — history always records. */
export async function appendEvent(
  paymentId: string,
  eventType: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE(),
      Item: {
        payment_id: paymentId,
        sk: `EVT#${new Date().toISOString()}#${randomUUID().slice(0, 8)}`,
        event_type: eventType,
        ...detail,
      },
    })
  );
}

export type ConfirmResult =
  | { outcome: 'applied'; payment: PaymentRecord }
  | { outcome: 'duplicate' }
  | { outcome: 'late_callback' }
  | { outcome: 'not_found' };

/**
 * Idempotent terminal transition from a provider callback (ADR-4a + F-1), as one transaction:
 *  - IDEM#{provider_txn_id} unique-constraint item (attribute_not_exists)
 *  - META status update conditioned on status still being open
 * Cancellation reasons distinguish duplicate (IDEM exists) from late callback (META terminal).
 */
export async function confirmPayment(input: {
  paymentId: string;
  providerTxnId: string;
  toStatus: 'SUCCESS' | 'FAILED';
  reason?: string;
  rawPayloadRef: string;
}): Promise<ConfirmResult> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE(),
              Item: {
                payment_id: input.paymentId,
                sk: `IDEM#${input.providerTxnId}`,
                processed_at: now,
              },
              ConditionExpression: 'attribute_not_exists(payment_id)',
            },
          },
          {
            Update: {
              TableName: TABLE(),
              Key: { payment_id: input.paymentId, sk: 'META' },
              UpdateExpression:
                'SET #status = :to, confirmed_at = :now, reason = :reason, provider_txn_id = :txn',
              ConditionExpression: 'attribute_exists(payment_id) AND #status IN (:open1, :open2)',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':to': input.toStatus,
                ':now': now,
                ':reason': input.reason ?? null,
                ':txn': input.providerTxnId,
                ':open1': OPEN_STATUSES[0],
                ':open2': OPEN_STATUSES[1],
              },
            },
          },
        ],
      })
    );
  } catch (err: unknown) {
    const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
    if (!reasons) throw err;
    const [idemReason, metaReason] = reasons;
    if (idemReason?.Code === 'ConditionalCheckFailed') return { outcome: 'duplicate' };
    if (metaReason?.Code === 'ConditionalCheckFailed') {
      const existing = await getPayment(input.paymentId);
      if (!existing) return { outcome: 'not_found' };
      // F-1: terminal already — record anomaly, publish nothing, move no money
      await appendEvent(input.paymentId, 'ANOMALY_LATE_CALLBACK', {
        attempted_status: input.toStatus,
        current_status: existing.status,
        provider_txn_id: input.providerTxnId,
        raw_payload_ref: input.rawPayloadRef,
      });
      return { outcome: 'late_callback' };
    }
    throw err;
  }
  await appendEvent(input.paymentId, `PAYMENT_${input.toStatus === 'SUCCESS' ? 'CONFIRMED' : 'FAILED'}`, {
    provider_txn_id: input.providerTxnId,
    raw_payload_ref: input.rawPayloadRef,
  });
  const payment = await getPayment(input.paymentId);
  return { outcome: 'applied', payment: payment as PaymentRecord };
}

/** Sweeper transition (ADR-5): open payment past expiry → EXPIRED. Conditional, race-safe vs callbacks. */
export async function expirePayment(paymentId: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { payment_id: paymentId, sk: 'META' },
        UpdateExpression: 'SET #status = :expired, confirmed_at = :now',
        ConditionExpression: '#status IN (:open1, :open2)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':expired': 'EXPIRED',
          ':now': new Date().toISOString(),
          ':open1': OPEN_STATUSES[0],
          ':open2': OPEN_STATUSES[1],
        },
      })
    );
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
  await appendEvent(paymentId, 'PAYMENT_EXPIRED', {});
  return true;
}

/** Announce-once guard (ADR-4b): the soundbox speaks exactly once per payment. */
export async function markAnnounced(paymentId: string, deviceId: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { payment_id: paymentId, sk: 'META' },
        UpdateExpression: 'SET announced_at = :now, announced_device_id = :device',
        ConditionExpression: 'attribute_exists(payment_id) AND attribute_not_exists(announced_at)',
        ExpressionAttributeValues: { ':now': new Date().toISOString(), ':device': deviceId },
      })
    );
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/** Exactly-once guard for wallet credit-back (same pattern as announce-once, ADR-4b). */
export async function markCreditedBack(paymentId: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { payment_id: paymentId, sk: 'META' },
        UpdateExpression: 'SET credited_back_at = :now',
        ConditionExpression: 'attribute_exists(payment_id) AND attribute_not_exists(credited_back_at)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      })
    );
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}
