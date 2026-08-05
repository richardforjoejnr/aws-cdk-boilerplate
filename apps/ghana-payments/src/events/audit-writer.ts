import type { EventBridgeEvent } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { ddb } from '../shared/clients.js';
import { emitMetrics, log } from '../shared/observability.js';
import { bumpStats } from '../shared/stats.js';

/**
 * Subscribes to every ghana.payments bus event: writes the audit trail (D9, TTL 90
 * days) AND is the single choke point for observability — emits transaction/latency
 * metrics (EMF, low-cardinality) and rolls up per-merchant usage counters.
 */
export const handler = async (
  event: EventBridgeEvent<string, Record<string, unknown>>
): Promise<void> => {
  const now = new Date();
  await ddb.send(
    new PutCommand({
      TableName: process.env.AUDIT_TABLE,
      Item: {
        date: now.toISOString().slice(0, 10),
        sk: `${now.toISOString()}#${randomUUID().slice(0, 8)}`,
        detail_type: event['detail-type'],
        source: event.source,
        detail: event.detail,
        ttl: Math.floor(now.getTime() / 1000) + 90 * 24 * 3600,
      },
    })
  );

  // Only payment lifecycle events carry usage/latency signal.
  const dt = event['detail-type'];
  const status =
    dt === 'payment.confirmed' ? 'SUCCESS' : dt === 'payment.failed' ? 'FAILED' : dt === 'payment.expired' ? 'EXPIRED' : null;
  if (!status) return;

  const d = event.detail;
  const amount = Number(d.amount ?? 0);
  const merchantId = String(d.merchant_id ?? 'unknown');
  const paymentId = String(d.payment_id ?? '');
  const date = now.toISOString().slice(0, 10);

  const props = { payment_id: paymentId, merchant_id: merchantId, amount, status };
  emitMetrics(
    [
      { name: 'TransactionCount', value: 1, unit: 'Count' },
      ...(status === 'SUCCESS'
        ? [{ name: 'TransactionAmountPesewas', value: amount, unit: 'Count' as const }]
        : []),
    ],
    { status },
    props
  );
  if (status !== 'SUCCESS') {
    emitMetrics([{ name: 'PaymentFailureCount', value: 1, unit: 'Count' }], { reason: String(d.reason ?? status) }, props);
  }
  // End-to-end latency (created -> confirmed/failed) when the event carries created_at.
  if (d.created_at) {
    const ms = now.getTime() - Date.parse(String(d.created_at));
    if (ms >= 0 && ms < 3600_000) {
      emitMetrics([{ name: 'PaymentLatencyMs', value: ms, unit: 'Milliseconds' }], { status }, props);
    }
  }

  try {
    await bumpStats('TOTAL', date, status, amount);
    await bumpStats(`MERCHANT#${merchantId}`, date, status, amount);
  } catch (err) {
    log('warn', 'stats_rollup_failed', { payment_id: paymentId, error: (err as Error).message });
  }
};
