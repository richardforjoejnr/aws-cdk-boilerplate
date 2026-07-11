import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, publishEvent } from '../shared/clients.js';
import { getConfig } from '../shared/config.js';
import { hashPhone } from '../shared/pii.js';
import {
  apiError,
  handleError,
  ok,
  parseBody,
  requirePesewas,
  requireString,
} from '../shared/http.js';
import { getProvider } from './provider.js';
import { appendEvent, createPayment } from './ledger.js';
import { debit, credit } from '../wallets/store.js';

interface InitiateBody {
  merchant_id: string;
  amount_pesewas: number;
  payer_phone: string;
}

/**
 * POST /v1/payments — wallet debit first (ADR-9: atomic check-and-debit; no payment
 * record on insufficient funds), then ledger INITIATED, then provider call.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = parseBody<InitiateBody>(event.body);
    const merchantId = requireString(body.merchant_id, 'merchant_id');
    const amount = requirePesewas(body.amount_pesewas, 'amount_pesewas');
    const payerPhone = requireString(body.payer_phone, 'payer_phone');
    const phoneHash = hashPhone(payerPhone);

    const merchant = await ddb.send(
      new GetCommand({
        TableName: process.env.MERCHANTS_TABLE,
        Key: { merchant_id: merchantId, sk: 'PROFILE' },
      })
    );
    if (!merchant.Item) return apiError(404, 'MERCHANT_NOT_FOUND', 'Merchant does not exist');
    if (merchant.Item.status !== 'ACTIVE') {
      return apiError(409, 'MERCHANT_NOT_ACTIVE', 'Merchant cannot accept payments');
    }

    if (!(await debit(phoneHash, amount))) {
      return apiError(402, 'INSUFFICIENT_FUNDS', 'Wallet balance is too low — top up first');
    }

    const cfg = await getConfig();
    let payment;
    try {
      payment = await createPayment({
        merchantId,
        payerPhoneHash: phoneHash,
        amountPesewas: amount,
        provider: 'MTN_MOMO',
      });
      const provider = getProvider(cfg.activeProvider);
      await provider.initiatePayment({
        paymentId: payment.payment_id,
        merchantId,
        payerPhone: payerPhone,
        amountPesewas: amount,
      });
    } catch (err) {
      // Provider/ledger failure after debit: put the money back immediately
      await credit(phoneHash, amount);
      if (payment) await appendEvent(payment.payment_id, 'INITIATION_ROLLED_BACK', {});
      throw err;
    }

    await publishEvent('payment.initiated', {
      event_id: `evt_${payment.payment_id}`,
      event_type: 'PAYMENT_INITIATED',
      provider: 'MTN_MOMO',
      provider_transaction_id: '',
      payment_id: payment.payment_id,
      merchant_id: merchantId,
      amount: amount,
      currency: 'GHS',
      event_time: payment.created_at,
    });

    return ok(
      { payment_id: payment.payment_id, status: payment.status, amount_pesewas: amount },
      201
    );
  } catch (err) {
    return handleError(err);
  }
};
