/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';
import { handler } from './status-updater.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);

process.env.DEVICES_TABLE = 'test-devices';
process.env.TELEMETRY_TABLE = 'test-telemetry';
process.env.PAYMENTS_TABLE = 'test-payments';

const deviceUpdates = () =>
  ddbMock.commandCalls(UpdateCommand).filter((c) => c.args[0].input.TableName === 'test-devices');
const paymentUpdates = () =>
  ddbMock.commandCalls(UpdateCommand).filter((c) => c.args[0].input.TableName === 'test-payments');
const puts = (table: string) =>
  ddbMock.commandCalls(PutCommand).filter((c) => c.args[0].input.TableName === table);

/** Collect EMF metric lines written by emitMetrics via console.log. */
const emfLines = (spy: jest.SpyInstance): any[] =>
  spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(String(c[0]));
      } catch {
        return null;
      }
    })
    .filter((j) => j && j._aws);

let logSpy: jest.SpyInstance;

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => logSpy.mockRestore());

describe('heartbeat (device row + telemetry)', () => {
  it('updates the device row and appends a telemetry point, normalising network_type', async () => {
    await handler({ device_id: 'dev_1', status: 'online', battery: 90, network_type: 'wifi', signal: -60 });

    const upd = deviceUpdates();
    expect(upd).toHaveLength(1);
    expect(upd[0].args[0].input.Key).toEqual({ device_id: 'dev_1' });
    expect(upd[0].args[0].input.ExpressionAttributeValues![':net']).toBe('WIFI');

    const tele = puts('test-telemetry');
    expect(tele).toHaveLength(1);
    expect(tele[0].args[0].input.Item).toMatchObject({ device_id: 'dev_1', network_type: 'WIFI', signal: -60 });
  });

  it('resolves fleet thing names (soundbox-<serial>) to the device_id via the serial GSI', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ device_id: 'dev_9', serial_number: 'SBX-9', status: 'ACTIVE' }] });

    await handler({ device_id: 'soundbox-SBX-9', status: 'online', battery: 80, network_type: '4G' });

    const gsiQuery = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(gsiQuery.TableName).toBe('test-devices');
    expect(gsiQuery.IndexName).toBe('GSI2');
    expect(gsiQuery.ExpressionAttributeValues).toMatchObject({ ':s': 'SBX-9' });

    const upd = deviceUpdates();
    expect(upd).toHaveLength(1);
    expect(upd[0].args[0].input.Key).toEqual({ device_id: 'dev_9' });

    const tele = puts('test-telemetry');
    expect(tele[0].args[0].input.Item).toMatchObject({ device_id: 'dev_9' });
  });
});

describe('played ack (audio confirmation latency)', () => {
  const playedMeta = {
    payment_id: 'pay_1',
    sk: 'META',
    merchant_id: 'mer_1',
    status: 'SUCCESS',
    created_at: '2026-08-06T10:00:00.000Z',
    confirmed_at: '2026-08-06T10:00:02.000Z',
    announced_at: '2026-08-06T10:00:02.500Z',
    played_at: '2026-08-06T10:00:03.500Z',
    played_network_type: '4G',
  };

  it('records played_at on the payment and emits latency metrics dimensioned by network_type', async () => {
    ddbMock
      .on(UpdateCommand, { TableName: 'test-payments' })
      .resolves({ Attributes: playedMeta });

    await handler({ device_id: 'dev_1', status: 'played', payment_id: 'pay_1', network_type: '4G' });

    // played_at set once (conditional) on the payment META
    const upd = paymentUpdates();
    expect(upd).toHaveLength(1);
    expect(upd[0].args[0].input.Key).toEqual({ payment_id: 'pay_1', sk: 'META' });
    expect(upd[0].args[0].input.ConditionExpression).toContain('attribute_not_exists(played_at)');

    // DEVICE_PLAYED event appended to the payment history
    const evt = puts('test-payments').find(
      (c) => (c.args[0].input.Item as any).event_type === 'DEVICE_PLAYED'
    );
    expect(evt).toBeDefined();

    // EMF: webhook->audio (the <5s SLO), announced->played, end-to-end — by network
    const metrics = emfLines(logSpy);
    const line = metrics.find((m) => m.WebhookToAudioMs !== undefined);
    expect(line).toBeDefined();
    expect(line.WebhookToAudioMs).toBe(1500); // confirmed 10:00:02 -> played 10:00:03.5
    expect(line.DeliveryLatencyMs).toBe(1000); // announced 10:00:02.5 -> played
    expect(line.EndToEndLatencyMs).toBe(3500); // created 10:00:00 -> played
    expect(line.network_type).toBe('4G');
  });

  it('ignores a duplicate played ack (already recorded) without metrics', async () => {
    ddbMock
      .on(UpdateCommand, { TableName: 'test-payments' })
      .rejects(Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }));

    await expect(
      handler({ device_id: 'dev_1', status: 'played', payment_id: 'pay_1', network_type: '4G' })
    ).resolves.toBeUndefined();

    expect(emfLines(logSpy)).toHaveLength(0);
    expect(puts('test-payments')).toHaveLength(0);
  });

  it('treats a played ack without payment_id as a plain heartbeat', async () => {
    await handler({ device_id: 'dev_1', status: 'played' });
    expect(paymentUpdates()).toHaveLength(0);
    expect(puts('test-payments')).toHaveLength(0);
    expect(deviceUpdates()).toHaveLength(1);
  });
});
