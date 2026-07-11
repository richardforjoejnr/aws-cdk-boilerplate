import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { publishEvent } from '../shared/clients.js';
import { apiError, ok } from '../shared/http.js';
import type { PaymentEvent } from '../shared/types.js';
import type { MockCallbackBody } from './mock-provider.js';
import { confirmPayment } from './ledger.js';

const s3 = new S3Client({});

/** Signature seam — stubbed for the PoC (ADR-8); real HMAC per provider later. */
function verifySignature(provider: string): boolean {
  return provider === 'mock';
}

/** Normalize a provider callback into the internal PaymentEvent (concept §9).
 *  merchant_id is filled from the ledger after the idempotent transition. */
function normalize(body: MockCallbackBody, rawRef: string): PaymentEvent {
  return {
    event_id: `evt_${randomUUID()}`,
    event_type: body.status === 'SUCCESSFUL' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_FAILED',
    provider: 'MTN_MOMO',
    provider_transaction_id: body.financialTransactionId,
    payment_id: body.externalId,
    merchant_id: '',
    amount: Math.round(parseFloat(body.amount) * 100),
    currency: 'GHS',
    event_time: new Date().toISOString(),
    raw_payload_ref: rawRef,
  };
}

/**
 * POST /v1/webhooks/{provider} — the §9 flow, implemented for real:
 * raw body to S3 inbox BEFORE processing -> normalize -> idempotent ledger transaction
 * (ADR-4a) -> publish to the bus. 200 only after durable writes; duplicates and late
 * callbacks are acknowledged 200 with no side effects (provider retries must be safe).
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const provider = event.pathParameters?.provider ?? 'unknown';
  if (!verifySignature(provider)) {
    return apiError(401, 'UNKNOWN_PROVIDER', 'Callback signature/provider not recognized');
  }
  if (!event.body) return apiError(400, 'MISSING_BODY', 'Callback body required');

  let body: MockCallbackBody;
  try {
    body = JSON.parse(event.body) as MockCallbackBody;
  } catch {
    return apiError(400, 'INVALID_JSON', 'Callback body must be JSON');
  }
  if (!body.externalId || !body.financialTransactionId || !body.status) {
    return apiError(400, 'INVALID_CALLBACK', 'Missing externalId/financialTransactionId/status');
  }

  // 1. Durable raw inbox write (Appendix B) — before any interpretation
  const now = new Date();
  const rawRef = `webhooks/${provider}/${now.toISOString().slice(0, 10)}/${body.externalId}-${randomUUID().slice(0, 8)}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.WEBHOOK_INBOX_BUCKET,
      Key: rawRef,
      Body: event.body,
      ContentType: 'application/json',
    })
  );

  // 2. Normalize + idempotent ledger transition
  const paymentEvent = normalize(body, `s3://${process.env.WEBHOOK_INBOX_BUCKET}/${rawRef}`);
  const result = await confirmPayment({
    paymentId: paymentEvent.payment_id,
    providerTxnId: paymentEvent.provider_transaction_id,
    toStatus: body.status === 'SUCCESSFUL' ? 'SUCCESS' : 'FAILED',
    reason: body.reason,
    rawPayloadRef: paymentEvent.raw_payload_ref as string,
  });

  if (result.outcome === 'duplicate') return ok({ received: true, duplicate: true });
  if (result.outcome === 'late_callback') return ok({ received: true, late: true });
  if (result.outcome === 'not_found') {
    // Callback for a payment we never created — inbox has the evidence; don't 5xx (no useful retry)
    console.error('Webhook for unknown payment', { payment_id: paymentEvent.payment_id, rawRef });
    return ok({ received: true, unknown_payment: true });
  }

  // 3. Publish exactly once, after the durable write
  await publishEvent(
    body.status === 'SUCCESSFUL' ? 'payment.confirmed' : 'payment.failed',
    { ...paymentEvent, merchant_id: result.payment.merchant_id, amount: result.payment.amount_pesewas }
  );
  return ok({ received: true });
};
