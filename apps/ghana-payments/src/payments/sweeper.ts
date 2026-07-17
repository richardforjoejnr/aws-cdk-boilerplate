import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, publishEvent } from '../shared/clients.js';
import { getConfig } from '../shared/config.js';
import { expirePayment, type PaymentRecord } from './ledger.js';

/**
 * Scheduled every minute (ADR-5): open payments older than the expiry window ->
 * EXPIRED + payment.expired event (credit-back listens to that). Conditional
 * transition makes the sweeper race-safe against a callback landing simultaneously.
 */
export const handler = async (): Promise<{ expired: number }> => {
  const cfg = await getConfig();
  const cutoff = new Date(Date.now() - cfg.sweeperExpiryMinutes * 60_000).toISOString();
  let expired = 0;

  for (const status of ['INITIATED', 'PENDING']) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: process.env.PAYMENTS_TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: '#status = :status AND created_at < :cutoff',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':cutoff': cutoff },
        Limit: 50,
      })
    );
    for (const item of (res.Items ?? []) as PaymentRecord[]) {
      if (!(await expirePayment(item.payment_id))) continue; // lost the race to a callback — correct
      expired++;
      await publishEvent('payment.expired', {
        event_id: `evt_exp_${item.payment_id}`,
        event_type: 'PAYMENT_EXPIRED',
        provider: item.provider,
        provider_transaction_id: '',
        payment_id: item.payment_id,
        merchant_id: item.merchant_id,
        amount: item.amount_pesewas,
        currency: 'GHS',
        event_time: new Date().toISOString(),
      });
    }
  }
  if (expired > 0) console.log(JSON.stringify({ msg: 'expired stale payments', expired }));
  return { expired };
};
