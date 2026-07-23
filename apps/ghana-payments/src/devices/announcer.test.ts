import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DescribeEndpointCommand, IoTClient } from '@aws-sdk/client-iot';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import type { EventBridgeEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import type { DeviceAnnouncement, PaymentEvent } from '../shared/types.js';
import { handler } from './announcer.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
const iotMock = mockClient(IoTClient);
const iotDataMock = mockClient(IoTDataPlaneClient);

process.env.DEVICES_TABLE = 'test-devices';
process.env.PAYMENTS_TABLE = 'test-payments';

const busEvent = (): EventBridgeEvent<'payment.confirmed', PaymentEvent> =>
  ({
    'detail-type': 'payment.confirmed',
    detail: {
      event_id: 'evt_1',
      event_type: 'PAYMENT_CONFIRMED',
      provider: 'MTN_MOMO',
      provider_transaction_id: 'mocktxn-abc',
      payment_id: 'pay_1',
      merchant_id: 'mer_1',
      amount: 2000,
      currency: 'GHS',
      event_time: '2026-01-01T00:00:00.000Z',
    },
  }) as unknown as EventBridgeEvent<'payment.confirmed', PaymentEvent>;

const device = (status: string) => ({
  device_id: 'dev_1',
  serial_number: 'SB-001',
  status,
  merchant_id: 'mer_1',
});

const publishedAnnouncement = (): DeviceAnnouncement => {
  const input = iotDataMock.commandCalls(PublishCommand)[0].args[0].input;
  return JSON.parse(Buffer.from(input.payload as Uint8Array).toString()) as DeviceAnnouncement;
};

beforeEach(() => {
  ddbMock.reset();
  iotMock.reset();
  iotDataMock.reset();
  iotMock.on(DescribeEndpointCommand).resolves({ endpointAddress: 'iot.test.amazonaws.com' });
  iotDataMock.on(PublishCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
});

describe('device announcer (ADR-4b announce-once)', () => {
  it('no PAIRED/ACTIVE device for the merchant -> no publish, no guard taken', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [device('UNASSIGNED'), device('RETIRED')] });
    await handler(busEvent());
    expect(iotDataMock.commandCalls(PublishCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('announce-once guard already taken -> NO second publish (redelivered event is silent)', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [device('ACTIVE')] });
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    await handler(busEvent());
    expect(iotDataMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it('publishes exactly one announcement to the per-device payments topic with the right shape', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [device('PAIRED')] });
    await handler(busEvent());

    const publishes = iotDataMock.commandCalls(PublishCommand);
    expect(publishes).toHaveLength(1);
    expect(publishes[0].args[0].input.topic).toBe('devices/dev_1/payments');
    expect(publishes[0].args[0].input.qos).toBe(1);

    const msg = publishedAnnouncement();
    expect(msg.event_type).toBe('ANNOUNCE_PAYMENT');
    expect(msg.payment_id).toBe('pay_1');
    expect(msg.amount).toBe(2000);
    expect(msg.currency).toBe('GHS');
    expect(msg.message).toBe('Payment received, 20.00 Ghana cedis');

    // guard was conditioned on announced_at not existing
    const guard = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(guard.ConditionExpression).toContain('attribute_not_exists(announced_at)');

    // history records the publish
    const evt = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(evt?.event_type).toBe('ANNOUNCEMENT_PUBLISHED');
    expect(evt?.device_id).toBe('dev_1');
  });

  it('a FLEET-provisioned device is announced on its Thing-name topic, not device_id', async () => {
    // Fleet devices connect as their Thing (soundbox-<serial>) and subscribe to
    // devices/<thing>/*, so the announcer must publish there — publishing to
    // device_id would go to a topic the device never hears (live-E2E regression).
    ddbMock.on(QueryCommand).resolves({
      Items: [{ ...device('ACTIVE'), thing_name: 'soundbox-SBX-DEMO-1' }],
    });
    await handler(busEvent());
    const publishes = iotDataMock.commandCalls(PublishCommand);
    expect(publishes).toHaveLength(1);
    expect(publishes[0].args[0].input.topic).toBe('devices/soundbox-SBX-DEMO-1/payments');
  });
});
