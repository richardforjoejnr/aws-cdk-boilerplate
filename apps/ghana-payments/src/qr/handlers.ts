import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { ddb } from '../shared/clients.js';
import { getConfig } from '../shared/config.js';
import { apiError, handleError, ok, parseBody } from '../shared/http.js';

const QR_TABLE = (): string => process.env.QR_CODES_TABLE ?? '';
const MERCHANTS_TABLE = (): string => process.env.MERCHANTS_TABLE ?? '';
const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'ROTATED', 'COMPROMISED'];

interface QrItem {
  qr_id: string;
  merchant_id: string;
  qr_type: 'STATIC';
  payload_url: string;
  status: string;
  created_at: string;
}

async function renderPng(url: string): Promise<string> {
  return (await QRCode.toDataURL(url, { width: 512, margin: 2 })).split(',')[1];
}

async function createQr(merchantId: string): Promise<{ item: QrItem; png: string }> {
  const cfg = await getConfig();
  if (!cfg.publicBaseUrl) {
    throw new Error('public-base-url SSM parameter not set — deploy the web stack first');
  }
  const qrId = `qr_${randomUUID().slice(0, 12)}`;
  const payloadUrl = `${cfg.publicBaseUrl}/pay/${qrId}`;
  const item: QrItem = {
    qr_id: qrId,
    merchant_id: merchantId,
    qr_type: 'STATIC',
    payload_url: payloadUrl,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: QR_TABLE(), Item: item }));
  return { item, png: await renderPng(payloadUrl) };
}

/** POST /v1/merchants/{id}/qrs — generate a static QR (admin, §8.2). */
export const generateHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const merchantId = event.pathParameters?.id;
    if (!merchantId) return apiError(400, 'MISSING_ID', 'merchant id required');
    const merchant = await ddb.send(
      new GetCommand({ TableName: MERCHANTS_TABLE(), Key: { merchant_id: merchantId, sk: 'PROFILE' } })
    );
    if (!merchant.Item) return apiError(404, 'MERCHANT_NOT_FOUND', 'No such merchant');
    const { item, png } = await createQr(merchantId);
    return ok(
      { qr_id: item.qr_id, payload_url: item.payload_url, status: item.status, png_base64: png },
      201
    );
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/qrs/{qr_id} — metadata + fresh PNG (admin). */
export const getHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const qrId = event.pathParameters?.qr_id;
    if (!qrId) return apiError(400, 'MISSING_ID', 'qr id required');
    const res = await ddb.send(new GetCommand({ TableName: QR_TABLE(), Key: { qr_id: qrId } }));
    if (!res.Item) return apiError(404, 'QR_NOT_FOUND', 'No such QR code');
    const item = res.Item as QrItem;
    return ok({ ...item, png_base64: await renderPng(item.payload_url) });
  } catch (err) {
    return handleError(err);
  }
};

/**
 * GET /v1/qrs/{qr_id}/resolve — PUBLIC: what the payment portal calls after a scan.
 * Returns the merchant display name (the anti-tamper check, §12.1) only for
 * ACTIVE QR + ACTIVE merchant.
 */
export const resolveHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const qrId = event.pathParameters?.qr_id;
    if (!qrId) return apiError(400, 'MISSING_ID', 'qr id required');
    const res = await ddb.send(new GetCommand({ TableName: QR_TABLE(), Key: { qr_id: qrId } }));
    if (!res.Item) return apiError(404, 'QR_NOT_FOUND', 'This QR code is not recognized');
    const qr = res.Item as QrItem;
    if (qr.status !== 'ACTIVE') {
      return apiError(410, 'QR_INACTIVE', 'This QR code is no longer active');
    }
    const merchant = await ddb.send(
      new GetCommand({
        TableName: MERCHANTS_TABLE(),
        Key: { merchant_id: qr.merchant_id, sk: 'PROFILE' },
      })
    );
    const profile = merchant.Item as
      | { display_name: string; business_category: string; status: string }
      | undefined;
    if (!profile || profile.status !== 'ACTIVE') {
      return apiError(410, 'MERCHANT_INACTIVE', 'This merchant cannot accept payments');
    }
    return ok({
      qr_id: qr.qr_id,
      merchant_id: qr.merchant_id,
      merchant_name: profile.display_name,
      business_category: profile.business_category,
      currency: 'GHS',
    });
  } catch (err) {
    return handleError(err);
  }
};

/** POST /v1/qrs/{qr_id}/rotate — mark compromised/rotated, issue replacement (admin, §8.2). */
export const rotateHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const qrId = event.pathParameters?.qr_id;
    if (!qrId) return apiError(400, 'MISSING_ID', 'qr id required');
    const res = await ddb.send(new GetCommand({ TableName: QR_TABLE(), Key: { qr_id: qrId } }));
    if (!res.Item) return apiError(404, 'QR_NOT_FOUND', 'No such QR code');
    const old = res.Item as QrItem;
    await ddb.send(
      new UpdateCommand({
        TableName: QR_TABLE(),
        Key: { qr_id: qrId },
        UpdateExpression: 'SET #status = :rotated, rotated_at = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':rotated': 'ROTATED', ':now': new Date().toISOString() },
      })
    );
    const { item, png } = await createQr(old.merchant_id);
    return ok({
      rotated_qr_id: qrId,
      qr_id: item.qr_id,
      payload_url: item.payload_url,
      png_base64: png,
    });
  } catch (err) {
    return handleError(err);
  }
};

/** PATCH /v1/qrs/{qr_id}/status (admin, §8.2). */
export const statusHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const qrId = event.pathParameters?.qr_id;
    if (!qrId) return apiError(400, 'MISSING_ID', 'qr id required');
    const body = parseBody<{ status: string }>(event.body);
    if (!VALID_STATUSES.includes(body.status)) {
      return apiError(400, 'INVALID_STATUS', `status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    await ddb.send(
      new UpdateCommand({
        TableName: QR_TABLE(),
        Key: { qr_id: qrId },
        UpdateExpression: 'SET #status = :status, updated_at = :now',
        ConditionExpression: 'attribute_exists(qr_id)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': body.status, ':now': new Date().toISOString() },
      })
    );
    return ok({ qr_id: qrId, status: body.status });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return apiError(404, 'QR_NOT_FOUND', 'No such QR code');
    }
    return handleError(err);
  }
};
