import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { assignHandler, manufactureHandler, unassignHandler, type DeviceItem } from './handlers.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);

process.env.DEVICES_TABLE = 'test-devices';
process.env.MERCHANTS_TABLE = 'test-merchants';
process.env.STAGE = 'dev';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;
interface ErrorResponse {
  error: { code: string };
}

const event = (
  body: Record<string, unknown> | null,
  pathParameters: Record<string, string> = {}
): APIGatewayProxyEvent =>
  ({ pathParameters, body: body ? JSON.stringify(body) : null }) as unknown as APIGatewayProxyEvent;

const conditionalFail = (): Error =>
  Object.assign(new Error('condition failed'), { name: 'ConditionalCheckFailedException' });

const provisioned: DeviceItem = {
  device_id: 'dev_1',
  serial_number: 'SBX-001',
  model: 'esp32-soundbox',
  device_type: 'REAL',
  status: 'PROVISIONED',
  thing_name: 'soundbox-SBX-001',
  created_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
});

describe('manufacture allow-list (POST /v1/fleet/serials)', () => {
  it('400s when serials is missing or empty', async () => {
    const res = await manufactureHandler(event({ serials: [] }));
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorResponse>(res).error.code).toBe('MISSING_SERIALS');
  });

  it('creates MANUFACTURED rows (device_type REAL) for new serials', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await manufactureHandler(event({ serials: ['SBX-001', 'SBX-002'] }));
    expect(res.statusCode).toBe(201);
    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(2);
    const item = puts[0].args[0].input.Item as DeviceItem;
    expect(item.status).toBe('MANUFACTURED');
    expect(item.device_type).toBe('REAL');
    expect(item.device_id).toMatch(/^dev_/);
    expect(parse<{ manufactured: string[] }>(res).manufactured).toEqual(['SBX-001', 'SBX-002']);
  });

  it('skips a serial that already exists (non-RETIRED) and reports it', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ ...provisioned, serial_number: 'SBX-001' }] });
    const res = await manufactureHandler(event({ serials: ['SBX-001'] }));
    expect(res.statusCode).toBe(201);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(parse<{ skipped: string[] }>(res).skipped).toEqual(['SBX-001']);
  });

  it('re-manufactures a serial whose only prior row is RETIRED', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ ...provisioned, status: 'RETIRED' }] });
    const res = await manufactureHandler(event({ serials: ['SBX-001'] }));
    expect(res.statusCode).toBe(201);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});

describe('remote assign (POST /v1/devices/{id}/assign)', () => {
  it('400s without a merchant_id', async () => {
    const res = await assignHandler(event({}, { id: 'dev_1' }));
    expect(res.statusCode).toBe(400);
  });

  it('404s when the merchant is missing or not ACTIVE', async () => {
    ddbMock.on(GetCommand, { TableName: 'test-merchants' }).resolves({ Item: undefined });
    const res = await assignHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_1' }));
    expect(res.statusCode).toBe(404);
    expect(parse<ErrorResponse>(res).error.code).toBe('MERCHANT_NOT_FOUND');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('binds a PROVISIONED device to the store (status ACTIVE) with no device round-trip', async () => {
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', status: 'ACTIVE' } });
    const res = await assignHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_1' }));
    expect(res.statusCode).toBe(200);
    const body = parse<{ merchant_id: string; status: string }>(res);
    expect(body.merchant_id).toBe('mer_1');
    expect(body.status).toBe('ACTIVE');
    const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.ExpressionAttributeValues?.[':mid']).toBe('mer_1');
    expect(update.UpdateExpression).toContain('merchant_id = :mid');
  });

  it('409s when the device is not assignable (e.g. still MANUFACTURED / RETIRED)', async () => {
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock.on(UpdateCommand).rejects(conditionalFail());
    const res = await assignHandler(event({ merchant_id: 'mer_1' }, { id: 'dev_1' }));
    expect(res.statusCode).toBe(409);
    expect(parse<ErrorResponse>(res).error.code).toBe('NOT_ASSIGNABLE');
  });
});

describe('unassign (POST /v1/devices/{id}/unassign)', () => {
  it('returns a device to PROVISIONED inventory and drops the merchant', async () => {
    const res = await unassignHandler(event(null, { id: 'dev_1' }));
    expect(res.statusCode).toBe(200);
    expect(parse<{ status: string }>(res).status).toBe('PROVISIONED');
    const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.UpdateExpression).toContain('REMOVE merchant_id');
  });

  it('404s an unknown device', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalFail());
    const res = await unassignHandler(event(null, { id: 'nope' }));
    expect(res.statusCode).toBe(404);
  });
});
