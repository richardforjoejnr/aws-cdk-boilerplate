import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { ddb } from '../shared/clients.js';
import { apiError, handleError, ok, parseBody, requireString } from '../shared/http.js';
import { hashPii } from '../shared/pii.js';

const TABLE = (): string => process.env.MERCHANTS_TABLE ?? '';
const VALID_STATUSES = ['PENDING_KYC', 'ACTIVE', 'SUSPENDED', 'CLOSED'];

// Payment methods a store can accept. The mock provider covers all of them in the
// PoC; the payment path validates a request against the store's enabled set.
export const SUPPORTED_PAYMENT_METHODS = ['MTN_MOMO', 'VODAFONE_CASH', 'AIRTELTIGO', 'CARD'] as const;
const DEFAULT_PAYMENT_METHODS = ['MTN_MOMO'];

interface MerchantItem {
  merchant_id: string;
  sk: 'PROFILE';
  display_name: string;
  phone_hash: string;
  ghana_card_hash?: string;
  business_category: string;
  payment_methods?: string[];
  status: string;
  kyc_level: string;
  created_at: string;
  status_reason?: string | null;
  updated_at?: string;
}

interface CreateBody {
  display_name: string;
  phone: string;
  business_category?: string;
  ghana_card?: string;
  payment_methods?: string[];
}

/** POST /v1/merchants (§8.1) — PoC activates immediately (no KYC verification, D9). */
export const createHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = parseBody<CreateBody>(event.body);
    // Which payment methods this store accepts (part of "setting up the store").
    const requested = Array.isArray(body.payment_methods) ? body.payment_methods : DEFAULT_PAYMENT_METHODS;
    const invalid = requested.filter(
      (m) => !SUPPORTED_PAYMENT_METHODS.includes(m as (typeof SUPPORTED_PAYMENT_METHODS)[number])
    );
    if (invalid.length > 0) {
      return apiError(400, 'INVALID_PAYMENT_METHOD', `Unsupported payment method(s): ${invalid.join(', ')}`);
    }
    const paymentMethods = requested.length > 0 ? [...new Set(requested)] : DEFAULT_PAYMENT_METHODS;
    const item = {
      merchant_id: `mer_${randomUUID().slice(0, 12)}`,
      sk: 'PROFILE',
      display_name: requireString(body.display_name, 'display_name'),
      phone_hash: hashPii(requireString(body.phone, 'phone')),
      business_category: body.business_category ?? 'general',
      payment_methods: paymentMethods,
      ...(body.ghana_card ? { ghana_card_hash: hashPii(body.ghana_card) } : {}),
      status: 'ACTIVE',
      kyc_level: 'NONE',
      created_at: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE(), Item: item }));
    return ok(
      {
        merchant_id: item.merchant_id,
        display_name: item.display_name,
        status: item.status,
        payment_methods: item.payment_methods,
      },
      201
    );
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/merchants — list for the merchant portal (PoC+; scan is fine at PoC scale). */
export const listHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE(),
        FilterExpression: 'sk = :profile',
        ExpressionAttributeValues: { ':profile': 'PROFILE' },
      })
    );
    const merchants = ((res.Items ?? []) as MerchantItem[]).map((m) => ({
      merchant_id: m.merchant_id,
      display_name: m.display_name,
      business_category: m.business_category,
      status: m.status,
      created_at: m.created_at,
    }));
    return ok({ merchants });
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/merchants/{id} */
export const getHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return apiError(400, 'MISSING_ID', 'merchant id required');
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE(), Key: { merchant_id: id, sk: 'PROFILE' } })
    );
    if (!res.Item) return apiError(404, 'MERCHANT_NOT_FOUND', 'No such merchant');
    const m = res.Item as MerchantItem;
    // PII hashes stay out of API responses
    return ok({
      merchant_id: m.merchant_id,
      display_name: m.display_name,
      business_category: m.business_category,
      payment_methods: m.payment_methods ?? [],
      status: m.status,
      kyc_level: m.kyc_level,
      created_at: m.created_at,
    });
  } catch (err) {
    return handleError(err);
  }
};

/**
 * DELETE /v1/merchants/{id} — remove for real (admin): deactivates the merchant's
 * QR badges (a scanned old badge then correctly resolves 410 "no longer active"),
 * then deletes all the merchant's items. Payment history stays in the ledger;
 * paired devices remain and can be removed separately.
 */
export const deleteHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return apiError(400, 'MISSING_ID', 'merchant id required');
    const existing = await ddb.send(
      new GetCommand({ TableName: TABLE(), Key: { merchant_id: id, sk: 'PROFILE' } })
    );
    if (!existing.Item) return apiError(404, 'MERCHANT_NOT_FOUND', 'No such merchant');

    const qrs = await ddb.send(
      new QueryCommand({
        TableName: process.env.QR_CODES_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'merchant_id = :m',
        ExpressionAttributeValues: { ':m': id },
      })
    );
    for (const qr of (qrs.Items ?? []) as Array<{ qr_id: string }>) {
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.QR_CODES_TABLE,
          Key: { qr_id: qr.qr_id },
          UpdateExpression: 'SET #status = :inactive, updated_at = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':inactive': 'INACTIVE', ':now': new Date().toISOString() },
        })
      );
    }

    const items = await ddb.send(
      new QueryCommand({
        TableName: TABLE(),
        KeyConditionExpression: 'merchant_id = :m',
        ExpressionAttributeValues: { ':m': id },
      })
    );
    for (const item of (items.Items ?? []) as Array<{ merchant_id: string; sk: string }>) {
      await ddb.send(
        new DeleteCommand({ TableName: TABLE(), Key: { merchant_id: item.merchant_id, sk: item.sk } })
      );
    }
    return ok({ merchant_id: id, deleted: true, qrs_deactivated: qrs.Items?.length ?? 0 });
  } catch (err) {
    return handleError(err);
  }
};

/** PATCH /v1/merchants/{id}/status — suspend = soft remove (§8.1). */
export const statusHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return apiError(400, 'MISSING_ID', 'merchant id required');
    const body = parseBody<{ status: string; reason?: string }>(event.body);
    if (!VALID_STATUSES.includes(body.status)) {
      return apiError(400, 'INVALID_STATUS', `status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE(),
        Key: { merchant_id: id, sk: 'PROFILE' },
        UpdateExpression: 'SET #status = :status, status_reason = :reason, updated_at = :now',
        ConditionExpression: 'attribute_exists(merchant_id)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': body.status,
          ':reason': body.reason ?? null,
          ':now': new Date().toISOString(),
        },
      })
    );
    return ok({ merchant_id: id, status: body.status });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return apiError(404, 'MERCHANT_NOT_FOUND', 'No such merchant');
    }
    return handleError(err);
  }
};
