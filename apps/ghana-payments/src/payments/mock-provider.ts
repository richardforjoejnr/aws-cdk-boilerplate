import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../shared/config.js';
import type { PaymentStatus } from '../shared/types.js';
import type { InitiatePaymentRequest, PaymentProviderAdapter } from './provider.js';

const sqs = new SQSClient({});

/** Callback body shaped like the MTN MoMo Collections callback (concept §17), so the
 *  real adapter's webhook path is identical. */
export interface MockCallbackBody {
  financialTransactionId: string;
  externalId: string; // our payment_id (MTN X-Reference-Id model)
  amount: string;
  currency: 'GHS';
  status: 'SUCCESSFUL' | 'FAILED';
  reason?: string;
  payer: { partyIdType: 'MSISDN'; partyId: string };
}

/**
 * Outcome by amount (ADR-7): FAIL_AMOUNT -> FAILED callback; TIMEOUT_AMOUNT -> no callback
 * (sweeper expires); DUPLICATE_AMOUNT -> same callback twice (same financialTransactionId);
 * anything else -> SUCCESS. Delivery via SQS DelaySeconds -> HTTPS POST to the real
 * public webhook endpoint (design-review F-2).
 */
export class MockMomoProvider implements PaymentProviderAdapter {
  async initiatePayment(req: InitiatePaymentRequest): Promise<{ providerRef: string }> {
    const cfg = await getConfig();
    const providerRef = req.paymentId;

    if (req.amountPesewas === cfg.timeoutAmountPesewas) {
      return { providerRef }; // silence — the sweeper's job (ADR-5)
    }

    const isFail = req.amountPesewas === cfg.failAmountPesewas;
    const body: MockCallbackBody = {
      financialTransactionId: `mocktxn-${randomUUID()}`,
      externalId: req.paymentId,
      amount: (req.amountPesewas / 100).toFixed(2),
      currency: 'GHS',
      status: isFail ? 'FAILED' : 'SUCCESSFUL',
      ...(isFail ? { reason: 'PAYER_LIMIT_REACHED' } : {}),
      payer: { partyIdType: 'MSISDN', partyId: req.payerPhone },
    };

    const copies = req.amountPesewas === cfg.duplicateAmountPesewas ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.MOCK_CALLBACK_QUEUE_URL,
          DelaySeconds: cfg.callbackDelaySeconds + i * 2,
          MessageBody: JSON.stringify(body),
        })
      );
    }
    return { providerRef };
  }

  async getStatus(): Promise<PaymentStatus> {
    // The mock's truth travels via its callback; polling reports PENDING (matches MTN's async model).
    return 'PENDING';
  }
}
