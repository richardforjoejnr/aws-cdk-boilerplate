import type { EventBridgeEvent } from 'aws-lambda';
import { publishEvent } from '../shared/clients.js';
import type { PaymentEvent } from '../shared/types.js';
import { appendEvent, getPayment, markCreditedBack } from '../payments/ledger.js';
import { credit } from '../wallets/store.js';

/**
 * Bus subscriber for payment.failed / payment.expired (ADR-9): put the money back.
 * Exactly-once via the ledger's credited_back_at conditional marker — EventBridge
 * retries and duplicate events are safe.
 */
export const handler = async (
  event: EventBridgeEvent<'payment.failed' | 'payment.expired', PaymentEvent>
): Promise<void> => {
  const { payment_id } = event.detail;
  const payment = await getPayment(payment_id);
  if (!payment) {
    console.error('credit-back: payment not found', { payment_id });
    return;
  }
  if (!(await markCreditedBack(payment_id))) return; // already credited — duplicate delivery
  await credit(payment.payer_phone_hash, payment.amount_pesewas);
  await appendEvent(payment_id, 'WALLET_CREDITED_BACK', {
    amount_pesewas: payment.amount_pesewas,
  });
  await publishEvent('wallet.credited', {
    payment_id,
    amount_pesewas: payment.amount_pesewas,
    reason: event['detail-type'],
  });
};
