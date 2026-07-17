import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { apiError, handleError, ok, parseBody, requirePesewas } from '../shared/http.js';
import { hashPhone } from '../shared/pii.js';
import { getWallet, topUp } from './store.js';

/** POST /v1/wallets/{phone}/topup — simulated funds (D7). */
export const topupHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const phone = event.pathParameters?.phone;
    if (!phone) return apiError(400, 'MISSING_PHONE', 'phone required');
    const body = parseBody<{ amount_pesewas: number }>(event.body);
    const amount = requirePesewas(body.amount_pesewas, 'amount_pesewas');
    const wallet = await topUp(hashPhone(phone), amount);
    return ok({ balance_pesewas: wallet.balance_pesewas });
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/wallets/{phone} — balance. */
export const getHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const phone = event.pathParameters?.phone;
    if (!phone) return apiError(400, 'MISSING_PHONE', 'phone required');
    const wallet = await getWallet(hashPhone(phone));
    return ok({ balance_pesewas: wallet?.balance_pesewas ?? 0 });
  } catch (err) {
    return handleError(err);
  }
};
