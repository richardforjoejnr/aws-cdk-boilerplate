import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';
import type { DeviceItem } from '../devices/handlers.js';
import { handler } from './pre-provisioning-hook.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);

process.env.DEVICES_TABLE = 'test-devices';
process.env.STAGE = 'dev';

const manufactured: DeviceItem = {
  device_id: 'dev_1',
  serial_number: 'SBX-001',
  model: 'esp32-soundbox',
  device_type: 'REAL',
  status: 'MANUFACTURED',
  created_at: '2026-01-01T00:00:00.000Z',
};

const evt = (serial?: string): { parameters?: Record<string, string> } =>
  serial === undefined ? {} : { parameters: { SerialNumber: serial } };

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
});

it('refuses provisioning when no serial is supplied', async () => {
  const res = await handler(evt());
  expect(res.allowProvisioning).toBe(false);
});

it('refuses an unknown serial (not in the manufactured allow-list)', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const res = await handler(evt('ATTACKER-999'));
  expect(res.allowProvisioning).toBe(false);
  // never advances a device it did not find
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
});

it('refuses a serial whose row is RETIRED (revoked hardware)', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ ...manufactured, status: 'RETIRED' }] });
  const res = await handler(evt('SBX-001'));
  expect(res.allowProvisioning).toBe(false);
});

it('allows a manufactured serial and advances it to PROVISIONED with a thing name', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [manufactured] });
  ddbMock.on(GetCommand).resolves({ Item: manufactured });
  const res = await handler(evt('SBX-001'));
  expect(res.allowProvisioning).toBe(true);
  expect(res.parameterOverrides?.SerialNumber).toBe('SBX-001');
  const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
  expect(update.ExpressionAttributeValues?.[':status']).toBe('PROVISIONED');
  expect(update.ExpressionAttributeValues?.[':tn']).toBe('soundbox-SBX-001');
});

it('a factory-reset device that was already assigned re-provisions back to ACTIVE (keeps its store)', async () => {
  const assigned = { ...manufactured, status: 'PROVISIONED', merchant_id: 'mer_1' };
  ddbMock.on(QueryCommand).resolves({ Items: [assigned] });
  ddbMock.on(GetCommand).resolves({ Item: assigned });
  const res = await handler(evt('SBX-001'));
  expect(res.allowProvisioning).toBe(true);
  const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
  expect(update.ExpressionAttributeValues?.[':status']).toBe('ACTIVE');
});

it('refuses when a concurrent write changed the row out from under it (race guard)', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [manufactured] });
  ddbMock.on(GetCommand).resolves({ Item: { ...manufactured, status: 'RETIRED' } });
  const res = await handler(evt('SBX-001'));
  expect(res.allowProvisioning).toBe(false);
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
});
