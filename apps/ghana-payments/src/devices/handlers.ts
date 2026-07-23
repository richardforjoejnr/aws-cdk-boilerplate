import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AttachPolicyCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
  DetachPolicyCommand,
  ListTargetsForPolicyCommand,
} from '@aws-sdk/client-iot';
import { randomInt, randomUUID } from 'node:crypto';
import { ddb } from '../shared/clients.js';
import { iot, getIotEndpoint, publishToDevice } from '../shared/iot.js';
import { apiError, handleError, ok, parseBody, requireString } from '../shared/http.js';

const DEVICES_TABLE = (): string => process.env.DEVICES_TABLE ?? '';
const MERCHANTS_TABLE = (): string => process.env.MERCHANTS_TABLE ?? '';
const PAIRING_CODE_TTL_MS = 10 * 60_000;
// Virtual soundboxes (browser demo, incl. links shared with others) get a
// non-expiring code so it survives being texted. Still SINGLE-USE — consumed on
// pairing. Real hardware keeps the short window (production-like security).
const NON_EXPIRING = 8_640_000_000_000_000; // max JS timestamp — effectively never
const VALID_STATUSES = ['UNASSIGNED', 'PAIRED', 'ACTIVE', 'OFFLINE', 'SUSPENDED', 'RETIRED'];

export interface DeviceItem {
  device_id: string;
  serial_number: string;
  model: string;
  device_type: 'VIRTUAL' | 'REAL';
  firmware_version?: string;
  notes?: string;
  // Lifecycle: MANUFACTURED (allow-listed, no cert) → PROVISIONED (fleet cert, no
  // merchant) → ACTIVE/PAIRED (assigned to a store) → SUSPENDED/RETIRED.
  status: string;
  merchant_id?: string;
  pending_merchant_id?: string;
  pairing_code?: string;
  pairing_code_expires?: number; // epoch ms — plain attribute, NOT a TTL attribute
  identity_id?: string;
  thing_name?: string; // set by fleet provisioning: soundbox-<serial>
  provisioned_at?: string; // set by the pre-provisioning hook
  paired_at?: string;
  assigned_at?: string; // set by remote assign
  last_seen_at?: string;
  created_at: string;
}

/** POST /v1/devices — register a soundbox (admin, §8.4). */
export const registerHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = parseBody<{
      serial_number: string;
      model?: string;
      device_type?: string;
      firmware_version?: string;
      notes?: string;
    }>(event.body);
    const serial = requireString(body.serial_number, 'serial_number');
    const deviceType = body.device_type === 'REAL' ? 'REAL' : 'VIRTUAL';
    const existing = await ddb.send(
      new QueryCommand({
        TableName: DEVICES_TABLE(),
        IndexName: 'GSI2',
        KeyConditionExpression: 'serial_number = :s',
        ExpressionAttributeValues: { ':s': serial },
      })
    );
    // RETIRED leftovers don't block re-registration (Remove = delete, but belt-and-braces)
    if (((existing.Items ?? []) as DeviceItem[]).some((d) => d.status !== 'RETIRED')) {
      return apiError(409, 'SERIAL_EXISTS', 'A device with this serial number is already registered');
    }
    const item: DeviceItem = {
      device_id: `dev_${randomUUID().slice(0, 12)}`,
      serial_number: serial,
      model: body.model ?? (deviceType === 'REAL' ? 'esp32-soundbox' : 'virtual-soundbox'),
      device_type: deviceType,
      ...(body.firmware_version ? { firmware_version: body.firmware_version } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
      status: 'UNASSIGNED',
      created_at: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: DEVICES_TABLE(), Item: item }));
    return ok(
      { device_id: item.device_id, serial_number: serial, device_type: deviceType, status: item.status },
      201
    );
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/devices — list for the admin portal. */
export const listHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const res = await ddb.send(new ScanCommand({ TableName: DEVICES_TABLE() }));
    const devices = ((res.Items ?? []) as DeviceItem[]).map((d) => ({
      device_id: d.device_id,
      serial_number: d.serial_number,
      model: d.model,
      device_type: d.device_type ?? 'VIRTUAL',
      firmware_version: d.firmware_version ?? null,
      status: d.status,
      merchant_id: d.merchant_id ?? null,
      pending_merchant_id: d.pending_merchant_id ?? null,
      // present + future => an unconsumed pairing code is outstanding (codes are
      // single-use; once pairing succeeds the code is deleted server-side, so a
      // paired device never has one to show). Endpoint is admin-key gated.
      pairing_code: d.pairing_code ?? null,
      pairing_code_expires: d.pairing_code_expires ?? null,
      last_seen_at: d.last_seen_at ?? null,
      created_at: d.created_at,
    }));
    return ok({ devices });
  } catch (err) {
    return handleError(err);
  }
};

/** POST /v1/devices/{id}/pairing-code — admin starts the §10.2 pairing flow. */
export const pairingCodeHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deviceId = event.pathParameters?.id;
    if (!deviceId) return apiError(400, 'MISSING_ID', 'device id required');
    const body = parseBody<{ merchant_id: string }>(event.body);
    const merchantId = requireString(body.merchant_id, 'merchant_id');

    const merchant = await ddb.send(
      new GetCommand({ TableName: MERCHANTS_TABLE(), Key: { merchant_id: merchantId, sk: 'PROFILE' } })
    );
    if (!merchant.Item || merchant.Item.status !== 'ACTIVE') {
      return apiError(404, 'MERCHANT_NOT_FOUND', 'Merchant missing or not ACTIVE');
    }

    // Idempotent within the validity window: if a still-valid unconsumed code already
    // exists for this same merchant, return IT rather than minting a new one.
    // Otherwise two near-simultaneous calls (register auto-issues a code, then "Pair…"
    // issues another) invalidate each other — the user types the first code and it
    // fails, retypes the second and it works. Strongly consistent read required.
    const current = await ddb.send(
      new GetCommand({ TableName: DEVICES_TABLE(), Key: { device_id: deviceId }, ConsistentRead: true })
    );
    const dev = current.Item as DeviceItem | undefined;
    if (
      dev?.pairing_code &&
      dev.pending_merchant_id === merchantId &&
      dev.pairing_code_expires &&
      dev.pairing_code_expires > Date.now()
    ) {
      return ok({
        device_id: deviceId,
        pairing_code: dev.pairing_code,
        expires_in_seconds: Math.round((dev.pairing_code_expires - Date.now()) / 1000),
      });
    }

    const code = String(randomInt(100000, 999999));
    const expiresAt = (dev?.device_type ?? 'VIRTUAL') === 'REAL'
      ? Date.now() + PAIRING_CODE_TTL_MS
      : NON_EXPIRING;
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: DEVICES_TABLE(),
          Key: { device_id: deviceId },
          UpdateExpression:
            'SET pairing_code = :code, pairing_code_expires = :exp, pending_merchant_id = :mid',
          ConditionExpression: 'attribute_exists(device_id) AND #status <> :retired',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':code': code,
            ':exp': expiresAt,
            ':mid': merchantId,
            ':retired': 'RETIRED',
          },
        })
      );
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return apiError(404, 'DEVICE_NOT_FOUND', 'Device missing or retired');
      }
      throw err;
    }
    return ok({
      device_id: deviceId,
      pairing_code: code,
      expires_in_seconds: expiresAt === NON_EXPIRING ? null : 600,
    });
  } catch (err) {
    return handleError(err);
  }
};

/**
 * POST /v1/devices/pair — PUBLIC: called by the device itself (§10.2).
 * Validates serial + short-lived code, binds device↔merchant, and attaches a
 * per-device IoT policy to the device's Cognito identity (spike-proven; the
 * broker enforces identity — vocovo-reuse-review §3).
 */
export const pairHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = parseBody<{
      serial_number: string;
      pairing_code: string;
      identity_id?: string; // virtual device (browser, Cognito identity)
      certificate_arn?: string; // real device (X.509 cert on port 8883)
    }>(event.body);
    const serial = requireString(body.serial_number, 'serial_number');
    const code = requireString(body.pairing_code, 'pairing_code');
    let policyTarget: string;
    if (body.certificate_arn) {
      if (!/^arn:aws:iot:[\w-]+:\d+:cert\/[0-9a-f]+$/.test(body.certificate_arn)) {
        return apiError(400, 'INVALID_CERTIFICATE', 'certificate_arn is not an IoT certificate ARN');
      }
      policyTarget = body.certificate_arn;
    } else {
      const identityId = requireString(body.identity_id, 'identity_id');
      if (!/^[\w-]+:[0-9a-f-]+$/.test(identityId)) {
        return apiError(400, 'INVALID_IDENTITY', 'identity_id is not a Cognito identity');
      }
      policyTarget = identityId;
    }

    const found = await ddb.send(
      new QueryCommand({
        TableName: DEVICES_TABLE(),
        IndexName: 'GSI2',
        KeyConditionExpression: 'serial_number = :s',
        ExpressionAttributeValues: { ':s': serial },
      })
    );
    const indexed = ((found.Items ?? []) as DeviceItem[]).find((d) => d.status !== 'RETIRED');
    if (!indexed) return apiError(404, 'DEVICE_NOT_FOUND', 'Unknown serial number');
    const fresh = await ddb.send(
      new GetCommand({
        TableName: DEVICES_TABLE(),
        Key: { device_id: indexed.device_id },
        ConsistentRead: true,
      })
    );
    const device = fresh.Item as DeviceItem | undefined;
    if (!device || device.status === 'RETIRED') {
      return apiError(404, 'DEVICE_NOT_FOUND', 'Unknown serial number');
    }
    if (
      !device.pairing_code ||
      device.pairing_code !== code ||
      !device.pairing_code_expires ||
      device.pairing_code_expires < Date.now() ||
      !device.pending_merchant_id
    ) {
      return apiError(401, 'INVALID_PAIRING_CODE', 'Pairing code is wrong or expired');
    }

    // Per-device IoT policy: this identity can only touch devices/{device_id}/* topics
    const region = process.env.AWS_REGION as string;
    const account = process.env.ACCOUNT_ID as string;
    const stage = process.env.STAGE as string;
    const policyName = `${stage}-ghana-device-${device.device_id}`;
    const policyDocument = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'iot:Connect',
          Resource: `arn:aws:iot:${region}:${account}:client/soundbox-${device.device_id}*`,
        },
        {
          Effect: 'Allow',
          Action: 'iot:Subscribe',
          Resource: `arn:aws:iot:${region}:${account}:topicfilter/devices/${device.device_id}/*`,
        },
        {
          Effect: 'Allow',
          Action: ['iot:Receive', 'iot:Publish'],
          Resource: `arn:aws:iot:${region}:${account}:topic/devices/${device.device_id}/*`,
        },
      ],
    });
    try {
      await iot.send(new CreatePolicyCommand({ policyName, policyDocument }));
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'ResourceAlreadyExistsException') throw err;
    }
    await iot.send(new AttachPolicyCommand({ policyName, target: policyTarget }));

    await ddb.send(
      new UpdateCommand({
        TableName: DEVICES_TABLE(),
        Key: { device_id: device.device_id },
        UpdateExpression:
          'SET #status = :paired, merchant_id = :mid, identity_id = :iid, paired_at = :now ' +
          'REMOVE pairing_code, pairing_code_expires, pending_merchant_id',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':paired': 'PAIRED',
          ':mid': device.pending_merchant_id,
          ':iid': policyTarget,
          ':now': new Date().toISOString(),
        },
      })
    );

    const merchantRes = await ddb.send(
      new GetCommand({
        TableName: MERCHANTS_TABLE(),
        Key: { merchant_id: device.pending_merchant_id, sk: 'PROFILE' },
      })
    );
    const merchantName =
      (merchantRes.Item as { display_name?: string } | undefined)?.display_name ??
      device.pending_merchant_id;

    return ok({
      device_id: device.device_id,
      merchant_id: device.pending_merchant_id,
      merchant_name: merchantName,
      auth_mode: body.certificate_arn ? 'certificate' : 'cognito',
      client_id: `soundbox-${device.device_id}`,
      topics: {
        payments: `devices/${device.device_id}/payments`,
        commands: `devices/${device.device_id}/commands`,
        heartbeat: `devices/${device.device_id}/heartbeat`,
      },
      iot_endpoint: await getIotEndpoint(),
      region,
    });
  } catch (err) {
    return handleError(err);
  }
};

/** POST /v1/devices/{id}/events — admin command (test announcement, volume) via the commands topic. */
export const commandHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deviceId = event.pathParameters?.id;
    if (!deviceId) return apiError(400, 'MISSING_ID', 'device id required');
    const body = parseBody<{ event_type: string; payload?: Record<string, unknown> }>(event.body);
    const eventType = requireString(body.event_type, 'event_type');
    const device = await ddb.send(
      new GetCommand({ TableName: DEVICES_TABLE(), Key: { device_id: deviceId } })
    );
    if (!device.Item) return apiError(404, 'DEVICE_NOT_FOUND', 'No such device');
    await publishToDevice(`devices/${deviceId}/commands`, {
      event_type: eventType,
      ...(body.payload ?? {}),
      timestamp: new Date().toISOString(),
    });
    return ok({ device_id: deviceId, sent: eventType });
  } catch (err) {
    return handleError(err);
  }
};

/** PATCH /v1/devices/{id}/status (admin, §8.4). */
export const statusHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deviceId = event.pathParameters?.id;
    if (!deviceId) return apiError(400, 'MISSING_ID', 'device id required');
    const body = parseBody<{ status: string; reason?: string }>(event.body);
    if (!VALID_STATUSES.includes(body.status)) {
      return apiError(400, 'INVALID_STATUS', `status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    await ddb.send(
      new UpdateCommand({
        TableName: DEVICES_TABLE(),
        Key: { device_id: deviceId },
        UpdateExpression: 'SET #status = :status, status_reason = :reason',
        ConditionExpression: 'attribute_exists(device_id)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': body.status, ':reason': body.reason ?? null },
      })
    );
    return ok({ device_id: deviceId, status: body.status });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return apiError(404, 'DEVICE_NOT_FOUND', 'No such device');
    }
    return handleError(err);
  }
};

/**
 * DELETE /v1/devices/{id} — remove a device for real (admin): detaches and deletes
 * its per-device IoT policy (created at pairing, not CFN-managed), then deletes the
 * item so the serial can be registered again.
 */
export const deleteHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deviceId = event.pathParameters?.id;
    if (!deviceId) return apiError(400, 'MISSING_ID', 'device id required');
    const res = await ddb.send(
      new GetCommand({ TableName: DEVICES_TABLE(), Key: { device_id: deviceId } })
    );
    if (!res.Item) return apiError(404, 'DEVICE_NOT_FOUND', 'No such device');

    // Tell a live device it has been removed BEFORE revoking access, so it
    // disconnects and clears its pairing immediately (best effort).
    try {
      await publishToDevice(`devices/${deviceId}/commands`, {
        event_type: 'DEVICE_REMOVED',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.log('device-removed notify skipped', (err as Error).message);
    }

    const stage = process.env.STAGE as string;
    const policyName = `${stage}-ghana-device-${deviceId}`;
    try {
      const targets = await iot.send(new ListTargetsForPolicyCommand({ policyName }));
      for (const target of targets.targets ?? []) {
        await iot.send(new DetachPolicyCommand({ policyName, target }));
      }
      await iot.send(new DeletePolicyCommand({ policyName }));
    } catch (err: unknown) {
      // never paired -> no policy; anything else shouldn't block removal of a demo device
      if ((err as { name?: string }).name !== 'ResourceNotFoundException') {
        console.error('IoT policy cleanup failed (continuing with delete)', err);
      }
    }

    await ddb.send(new DeleteCommand({ TableName: DEVICES_TABLE(), Key: { device_id: deviceId } }));
    return ok({ device_id: deviceId, deleted: true });
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/soundbox/config — PUBLIC: bootstrap config for the soundbox portal. */
export const configHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    return ok({
      region: process.env.AWS_REGION,
      identity_pool_id: process.env.IDENTITY_POOL_ID,
      iot_endpoint: await getIotEndpoint(),
    });
  } catch (err) {
    return handleError(err);
  }
};

/**
 * POST /v1/fleet/serials — admin: record manufactured serials in the allow-list.
 * These rows (status MANUFACTURED) are what the pre-provisioning hook checks
 * before letting a device mint its own cert via fleet provisioning. This is the
 * "these are the units we built" register — done once at the factory/warehouse.
 */
export const manufactureHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = parseBody<{ serials: string[]; model?: string; notes?: string }>(event.body);
    if (!Array.isArray(body.serials) || body.serials.length === 0) {
      return apiError(400, 'MISSING_SERIALS', 'serials must be a non-empty array');
    }
    const created: string[] = [];
    const skipped: string[] = [];
    for (const raw of body.serials) {
      const serial = String(raw).trim();
      if (!serial) continue;
      const existing = await ddb.send(
        new QueryCommand({
          TableName: DEVICES_TABLE(),
          IndexName: 'GSI2',
          KeyConditionExpression: 'serial_number = :s',
          ExpressionAttributeValues: { ':s': serial },
        })
      );
      if (((existing.Items ?? []) as DeviceItem[]).some((d) => d.status !== 'RETIRED')) {
        skipped.push(serial);
        continue;
      }
      const item: DeviceItem = {
        device_id: `dev_${randomUUID().slice(0, 12)}`,
        serial_number: serial,
        model: body.model ?? 'esp32-soundbox',
        device_type: 'REAL',
        ...(body.notes ? { notes: body.notes } : {}),
        status: 'MANUFACTURED',
        created_at: new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: DEVICES_TABLE(), Item: item }));
      created.push(serial);
    }
    return ok({ manufactured: created, skipped }, 201);
  } catch (err) {
    return handleError(err);
  }
};

/**
 * POST /v1/devices/{id}/assign — admin: bind a provisioned device to a store.
 * This is the "pair to a merchant" step, done entirely server-side — no device
 * interaction, no pairing code. Because announce routing is merchant→device, the
 * device starts announcing that store's payments the instant this returns, and it
 * can be re-assigned to another store any time.
 */
export const assignHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deviceId = event.pathParameters?.id;
    if (!deviceId) return apiError(400, 'MISSING_ID', 'device id required');
    const body = parseBody<{ merchant_id: string }>(event.body);
    const merchantId = requireString(body.merchant_id, 'merchant_id');

    const merchant = await ddb.send(
      new GetCommand({ TableName: MERCHANTS_TABLE(), Key: { merchant_id: merchantId, sk: 'PROFILE' } })
    );
    if (!merchant.Item || merchant.Item.status !== 'ACTIVE') {
      return apiError(404, 'MERCHANT_NOT_FOUND', 'Merchant missing or not ACTIVE');
    }

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: DEVICES_TABLE(),
          Key: { device_id: deviceId },
          UpdateExpression:
            'SET #status = :active, merchant_id = :mid, assigned_at = :now ' +
            'REMOVE pairing_code, pairing_code_expires, pending_merchant_id',
          // Only a provisioned/assignable device can be bound — not one still
          // MANUFACTURED (no cert yet), RETIRED, or SUSPENDED.
          ConditionExpression:
            'attribute_exists(device_id) AND #status IN (:provisioned, :active, :paired, :unassigned)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':active': 'ACTIVE',
            ':mid': merchantId,
            ':now': new Date().toISOString(),
            ':provisioned': 'PROVISIONED',
            ':paired': 'PAIRED',
            ':unassigned': 'UNASSIGNED',
          },
        })
      );
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return apiError(409, 'NOT_ASSIGNABLE', 'Device is not provisioned, or is retired/suspended');
      }
      throw err;
    }
    return ok({ device_id: deviceId, merchant_id: merchantId, status: 'ACTIVE' });
  } catch (err) {
    return handleError(err);
  }
};

/** POST /v1/devices/{id}/unassign — admin: return a device to unassigned inventory. */
export const unassignHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deviceId = event.pathParameters?.id;
    if (!deviceId) return apiError(400, 'MISSING_ID', 'device id required');
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: DEVICES_TABLE(),
          Key: { device_id: deviceId },
          UpdateExpression: 'SET #status = :provisioned REMOVE merchant_id, assigned_at, paired_at',
          ConditionExpression: 'attribute_exists(device_id)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':provisioned': 'PROVISIONED' },
        })
      );
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return apiError(404, 'DEVICE_NOT_FOUND', 'No such device');
      }
      throw err;
    }
    return ok({ device_id: deviceId, status: 'PROVISIONED' });
  } catch (err) {
    return handleError(err);
  }
};
