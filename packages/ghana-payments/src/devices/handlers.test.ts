import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AttachPolicyCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
  DescribeEndpointCommand,
  DetachPolicyCommand,
  IoTClient,
  ListTargetsForPolicyCommand,
} from '@aws-sdk/client-iot';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import {
  deleteHandler,
  pairHandler,
  pairingCodeHandler,
  registerHandler,
  type DeviceItem,
} from './handlers.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
const iotMock = mockClient(IoTClient);
const iotDataMock = mockClient(IoTDataPlaneClient);

process.env.DEVICES_TABLE = 'test-devices';
process.env.MERCHANTS_TABLE = 'test-merchants';
process.env.AWS_REGION = 'us-east-1';
process.env.ACCOUNT_ID = '123456789012';
process.env.STAGE = 'dev';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;

interface ErrorResponse {
  error: { code: string };
}
interface PairResponse {
  device_id: string;
  merchant_id: string;
  auth_mode: string;
  client_id: string;
  topics: { payments: string; commands: string; heartbeat: string };
}

const event = (
  body: Record<string, unknown> | null,
  pathParameters: Record<string, string> = {}
): APIGatewayProxyEvent =>
  ({ pathParameters, body: body ? JSON.stringify(body) : null }) as unknown as APIGatewayProxyEvent;

const IDENTITY = 'us-east-1:11111111-2222-3333-4444-555555555555';
const CERT_ARN = 'arn:aws:iot:us-east-1:123456789012:cert/abc123def4567890';

const baseDevice: DeviceItem = {
  device_id: 'dev_1',
  serial_number: 'SB-001',
  model: 'virtual-soundbox',
  device_type: 'VIRTUAL',
  status: 'UNASSIGNED',
  created_at: '2026-01-01T00:00:00.000Z',
};

const pairableDevice = (overrides: Partial<DeviceItem> = {}): DeviceItem => ({
  ...baseDevice,
  pairing_code: '123456',
  pairing_code_expires: Date.now() + 60_000,
  pending_merchant_id: 'mer_1',
  ...overrides,
});

beforeEach(() => {
  ddbMock.reset();
  iotMock.reset();
  iotDataMock.reset();
  iotMock.on(DescribeEndpointCommand).resolves({ endpointAddress: 'iot.test.amazonaws.com' });
  iotMock.on(CreatePolicyCommand).resolves({});
  iotMock.on(AttachPolicyCommand).resolves({});
  iotDataMock.on(PublishCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
});

describe('device registration', () => {
  it('409s a duplicate serial number', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ ...baseDevice, status: 'PAIRED' }] });
    const res = await registerHandler(event({ serial_number: 'SB-001' }));
    expect(res.statusCode).toBe(409);
    expect(parse<ErrorResponse>(res).error.code).toBe('SERIAL_EXISTS');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('a RETIRED leftover with the same serial does NOT block re-registration', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ ...baseDevice, status: 'RETIRED' }] });
    const res = await registerHandler(event({ serial_number: 'SB-001' }));
    expect(res.statusCode).toBe(201);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item?.status).toBe('UNASSIGNED');
    expect(item?.device_id).toMatch(/^dev_/);
  });
});

describe('pairing-code issuance (§10.2 step 1)', () => {
  it('issues a 6-digit non-expiring code for a VIRTUAL device (shareable)', async () => {
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock
      .on(GetCommand, { TableName: 'test-devices' })
      .resolves({ Item: { device_id: 'dev_1', device_type: 'VIRTUAL', status: 'UNASSIGNED' } });
    const res = await pairingCodeHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_1' }));
    expect(res.statusCode).toBe(200);
    const body = parse<{ pairing_code: string; expires_in_seconds: number | null }>(res);
    expect(body.pairing_code).toMatch(/^\d{6}$/);
    expect(body.expires_in_seconds).toBeNull(); // virtual codes don't expire
    const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.ConditionExpression).toContain('#status <> :retired'); // RETIRED can't get a code
    expect(update.ExpressionAttributeValues?.[':exp']).toBeGreaterThan(Date.now() + 365 * 24 * 3600 * 1000);
  });

  it('issues a 10-minute code for a REAL device (production-like security)', async () => {
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock
      .on(GetCommand, { TableName: 'test-devices' })
      .resolves({ Item: { device_id: 'dev_1', device_type: 'REAL', status: 'UNASSIGNED' } });
    const res = await pairingCodeHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_1' }));
    expect(parse<{ expires_in_seconds: number }>(res).expires_in_seconds).toBe(600);
    const exp = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues?.[':exp'] as number;
    expect(exp).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
  });

  it('404s when the device is missing or RETIRED (condition failed)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await pairingCodeHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_gone' }));
    expect(res.statusCode).toBe(404);
    expect(parse<ErrorResponse>(res).error.code).toBe('DEVICE_NOT_FOUND');
  });

  it('404s when the merchant is not ACTIVE', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { merchant_id: 'mer_1', status: 'SUSPENDED' } });
    const res = await pairingCodeHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_1' }));
    expect(res.statusCode).toBe(404);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  // Regression: register auto-issues a code, then "Pair…" issued another, invalidating
  // the first — the user typed the first, it failed, retyped the second, it worked.
  it('is idempotent within the window: returns the SAME live code, no new write', async () => {
    const liveExpiry = Date.now() + 5 * 60_000;
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock.on(GetCommand, { TableName: 'test-devices' }).resolves({
      Item: {
        device_id: 'dev_1',
        pairing_code: '123456',
        pending_merchant_id: 'mer_1',
        pairing_code_expires: liveExpiry,
        status: 'UNASSIGNED',
      },
    });
    const res = await pairingCodeHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_1' }));
    expect(res.statusCode).toBe(200);
    expect(parse<{ pairing_code: string }>(res).pairing_code).toBe('123456');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0); // no new code minted
  });

  it('mints a new code when the existing one is for a DIFFERENT merchant', async () => {
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_2', status: 'ACTIVE' } });
    ddbMock.on(GetCommand, { TableName: 'test-devices' }).resolves({
      Item: {
        device_id: 'dev_1',
        pairing_code: '123456',
        pending_merchant_id: 'mer_1',
        pairing_code_expires: Date.now() + 5 * 60_000,
        status: 'UNASSIGNED',
      },
    });
    const res = await pairingCodeHandler(event({ merchant_id: 'mer_2' }, { id: 'dev_1' }));
    expect(res.statusCode).toBe(200);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1); // new code written
  });
});

describe('device pairing (§10.2 step 2, public endpoint)', () => {
  const pairBody = (extra: Record<string, unknown> = {}) => ({
    serial_number: 'SB-001',
    pairing_code: '123456',
    identity_id: IDENTITY,
    ...extra,
  });

  function primeHappyPath(device: DeviceItem): void {
    ddbMock.on(QueryCommand).resolves({ Items: [device] });
    ddbMock
      .on(GetCommand, { TableName: 'test-devices' })
      .resolves({ Item: device });
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', display_name: 'Ama', status: 'ACTIVE' } });
  }

  it('rejects a wrong code with 401 and attaches no policy', async () => {
    primeHappyPath(pairableDevice({ pairing_code: '999999' }));
    const res = await pairHandler(event(pairBody()));
    expect(res.statusCode).toBe(401);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_PAIRING_CODE');
    expect(iotMock.commandCalls(AttachPolicyCommand)).toHaveLength(0);
  });

  it('rejects an expired code with 401', async () => {
    primeHappyPath(pairableDevice({ pairing_code_expires: Date.now() - 1 }));
    const res = await pairHandler(event(pairBody()));
    expect(res.statusCode).toBe(401);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_PAIRING_CODE');
  });

  it('validates against a strongly-consistent read, not the GSI projection', async () => {
    primeHappyPath(pairableDevice());
    await pairHandler(event(pairBody()));
    const deviceGets = ddbMock
      .commandCalls(GetCommand)
      .filter((c) => c.args[0].input.TableName === 'test-devices');
    expect(deviceGets.length).toBeGreaterThan(0);
    expect(deviceGets[0].args[0].input.ConsistentRead).toBe(true);
  });

  it('binds the device, attaches a per-device policy to the COGNITO IDENTITY, and consumes the code', async () => {
    primeHappyPath(pairableDevice());
    const res = await pairHandler(event(pairBody()));
    expect(res.statusCode).toBe(200);
    const body = parse<PairResponse>(res);
    expect(body.auth_mode).toBe('cognito');
    expect(body.merchant_id).toBe('mer_1');
    expect(body.client_id).toBe('soundbox-dev_1');
    expect(body.topics.payments).toBe('devices/dev_1/payments');

    const attach = iotMock.commandCalls(AttachPolicyCommand)[0].args[0].input;
    expect(attach.target).toBe(IDENTITY);
    expect(attach.policyName).toBe('dev-ghana-device-dev_1');

    // Policy is scoped to this device's topics only (vocovo-reuse-review §1)
    const policyDoc = iotMock.commandCalls(CreatePolicyCommand)[0].args[0].input
      .policyDocument as string;
    expect(policyDoc).toContain('topicfilter/devices/dev_1/*');
    expect(policyDoc).toContain('client/soundbox-dev_1*');

    // Pairing code is single-use: removed in the binding update
    const update = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => c.args[0].input.TableName === 'test-devices');
    expect(update?.args[0].input.UpdateExpression).toContain('REMOVE pairing_code');
    expect(update?.args[0].input.ExpressionAttributeValues?.[':paired']).toBe('PAIRED');
  });

  it('attaches the policy to the CERTIFICATE ARN for a real device', async () => {
    primeHappyPath(pairableDevice({ device_type: 'REAL' }));
    const res = await pairHandler(
      event({ serial_number: 'SB-001', pairing_code: '123456', certificate_arn: CERT_ARN })
    );
    expect(res.statusCode).toBe(200);
    expect(parse<PairResponse>(res).auth_mode).toBe('certificate');
    expect(iotMock.commandCalls(AttachPolicyCommand)[0].args[0].input.target).toBe(CERT_ARN);
  });

  it('400s a malformed certificate ARN before any lookup', async () => {
    const res = await pairHandler(
      event({
        serial_number: 'SB-001',
        pairing_code: '123456',
        certificate_arn: 'arn:aws:iam::123456789012:role/eviltwin',
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_CERTIFICATE');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('400s a malformed Cognito identity id', async () => {
    const res = await pairHandler(
      event({ serial_number: 'SB-001', pairing_code: '123456', identity_id: 'not an identity' })
    );
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_IDENTITY');
  });

  it('404s an unknown serial and a RETIRED device', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await pairHandler(event(pairBody()));
    expect(res.statusCode).toBe(404);

    ddbMock.on(QueryCommand).resolves({ Items: [pairableDevice()] });
    ddbMock
      .on(GetCommand, { TableName: 'test-devices' })
      .resolves({ Item: pairableDevice({ status: 'RETIRED' }) });
    const res2 = await pairHandler(event(pairBody()));
    expect(res2.statusCode).toBe(404);
  });
});

describe('device deletion (reverses pairing)', () => {
  it('detaches every policy target, deletes the policy, then deletes the item', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...baseDevice, status: 'PAIRED' } });
    iotMock
      .on(ListTargetsForPolicyCommand)
      .resolves({ targets: [IDENTITY, CERT_ARN] });
    iotMock.on(DetachPolicyCommand).resolves({});
    iotMock.on(DeletePolicyCommand).resolves({});

    const res = await deleteHandler(event(null, { id: 'dev_1' }));
    expect(res.statusCode).toBe(200);

    const detaches = iotMock.commandCalls(DetachPolicyCommand);
    expect(detaches.map((c) => c.args[0].input.target)).toEqual([IDENTITY, CERT_ARN]);
    expect(iotMock.commandCalls(DeletePolicyCommand)[0].args[0].input.policyName).toBe(
      'dev-ghana-device-dev_1'
    );
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);

    // Live device is told it was removed (best effort) before access is revoked
    const publish = iotDataMock.commandCalls(PublishCommand)[0].args[0].input;
    expect(publish.topic).toBe('devices/dev_1/commands');
    expect(JSON.parse(Buffer.from(publish.payload as Uint8Array).toString()) as { event_type: string }).toMatchObject({
      event_type: 'DEVICE_REMOVED',
    });
  });

  it('a never-paired device (no policy) still deletes cleanly', async () => {
    ddbMock.on(GetCommand).resolves({ Item: baseDevice });
    iotMock
      .on(ListTargetsForPolicyCommand)
      .rejects(Object.assign(new Error('nope'), { name: 'ResourceNotFoundException' }));
    const res = await deleteHandler(event(null, { id: 'dev_1' }));
    expect(res.statusCode).toBe(200);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it('404s an unknown device', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await deleteHandler(event(null, { id: 'dev_x' }));
    expect(res.statusCode).toBe(404);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});
