import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { apiError, handleError, ok } from '../shared/http.js';
import { getPayment } from './ledger.js';

/** GET /v1/payments/{id} — normalized status; the payment portal polls this. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return apiError(400, 'MISSING_ID', 'payment id required');
    const payment = await getPayment(id);
    if (!payment) return apiError(404, 'PAYMENT_NOT_FOUND', 'No such payment');
    return ok({
      payment_id: payment.payment_id,
      status: payment.status,
      amount_pesewas: payment.amount_pesewas,
      merchant_id: payment.merchant_id,
      created_at: payment.created_at,
      confirmed_at: payment.confirmed_at ?? null,
      reason: payment.reason ?? null,
    });
  } catch (err) {
    return handleError(err);
  }
};
