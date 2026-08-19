/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { overviewHandler, traceHandler, failuresHandler, fleetHandler, latencyHandler, batteryHandler, authAttemptsHandler } from './handlers.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

process.env.METRICS_TABLE = 'm';
process.env.PAYMENTS_TABLE = 'p';
process.env.DEVICES_TABLE = 'd';
process.env.STAGE = 'dev';
process.env.AWS_REGION = 'us-east-1';
process.env.ACCOUNT_ID = '123456789012';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;
const event = (q: Record<string, string> = {}, pp: Record<string, string> = {}): APIGatewayProxyEvent =>
  ({ queryStringParameters: q, pathParameters: pp }) as unknown as APIGatewayProxyEvent;

beforeEach(() => {
  ddbMock.reset();
  sqsMock.reset();
});

describe('overview', () => {
  it('aggregates daily TOTAL rows and ranks top merchants/soundboxes by volume', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({
        Items: [
          { pk: 'TOTAL', date: '2026-08-04', txn_count: 3, volume_pesewas: 30000, success_count: 2, failed_count: 1 },
          { pk: 'TOTAL', date: '2026-08-05', txn_count: 1, volume_pesewas: 5000, success_count: 1 },
        ],
      });
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { pk: 'MERCHANT#mer_1', date: '2026-08-04', txn_count: 2, volume_pesewas: 20000 },
        { pk: 'MERCHANT#mer_2', date: '2026-08-05', txn_count: 1, volume_pesewas: 5000 },
        { pk: 'DEVICE#dev_1', date: '2026-08-04', txn_count: 3, volume_pesewas: 35000 },
      ],
    });
    const res = await overviewHandler(event({ days: '7' }));
    expect(res.statusCode).toBe(200);
    const b = parse<any>(res);
    expect(b.totals.transactions).toBe(4);
    expect(b.totals.volume_pesewas).toBe(35000);
    expect(b.success_rate).toBeCloseTo(0.75);
    expect(b.top_merchants[0].id).toBe('mer_1');
    expect(b.top_soundboxes[0].id).toBe('dev_1');
  });
});

describe('trace', () => {
  it('404s an unknown payment', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await traceHandler(event({}, { payment_id: 'nope' }));
    expect(res.statusCode).toBe(404);
  });

  it('builds an ordered timeline with per-stage latency from EVT# rows', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { payment_id: 'pay_1', sk: 'META', merchant_id: 'mer_1', amount_pesewas: 12000, status: 'SUCCESS' },
        { payment_id: 'pay_1', sk: 'EVT#2026-08-05T10:00:00.000Z#a', event_type: 'PAYMENT_INITIATED' },
        { payment_id: 'pay_1', sk: 'EVT#2026-08-05T10:00:06.000Z#b', event_type: 'PAYMENT_CONFIRMED' },
        { payment_id: 'pay_1', sk: 'EVT#2026-08-05T10:00:06.500Z#c', event_type: 'ANNOUNCEMENT_PUBLISHED' },
      ],
    });
    const res = await traceHandler(event({}, { payment_id: 'pay_1' }));
    expect(res.statusCode).toBe(200);
    const b = parse<any>(res);
    expect(b.merchant_id).toBe('mer_1');
    expect(b.timeline.map((e: any) => e.event_type)).toEqual([
      'PAYMENT_INITIATED',
      'PAYMENT_CONFIRMED',
      'ANNOUNCEMENT_PUBLISHED',
    ]);
    expect(b.timeline[1].delta_ms).toBe(6000); // initiated -> confirmed
    expect(b.timeline[2].delta_ms).toBe(500); // confirmed -> announced
    expect(b.total_ms).toBe(6500);
  });
});

describe('fleet', () => {
  it('reports online/offline and network mix (no battery — dropped from observability)', async () => {
    const now = new Date().toISOString();
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { device_id: 'dev_1', serial_number: 'SBX-1', status: 'ACTIVE', last_seen_at: now, battery: 80, network_type: '4G' },
        { device_id: 'dev_2', serial_number: 'SBX-2', status: 'ACTIVE', last_seen_at: '2020-01-01T00:00:00.000Z', battery: 40, network_type: 'WIFI' },
        { device_id: 'dev_3', serial_number: 'SBX-3', status: 'RETIRED' },
      ],
    });
    const res = await fleetHandler();
    expect(res.statusCode).toBe(200);
    const b = parse<any>(res);
    expect(b.summary.total).toBe(2); // RETIRED excluded
    expect(b.summary.online).toBe(1);
    expect(b.summary.networks).toEqual({ '4G': 1, WIFI: 1 });
    expect(b.summary.avg_battery).toBeUndefined();
    expect(b.devices[0].battery).toBeUndefined();
  });
});

describe('latency', () => {
  // Four SUCCESS payments spanning the flow permutations:
  //  pay_1  4G   played, webhook->audio 1500ms  (under the 5s target)
  //  pay_2  WIFI played, webhook->audio 6000ms  (over the target)
  //  pay_3  --   announced but never played (delivery gap)
  //  pay_4  --   never announced (no paired device)
  const payments = [
    {
      payment_id: 'pay_1', status: 'SUCCESS',
      created_at: '2026-08-05T10:00:00.000Z',
      confirmed_at: '2026-08-05T10:00:02.000Z',
      announced_at: '2026-08-05T10:00:02.500Z',
      played_at: '2026-08-05T10:00:03.500Z',
      played_network_type: '4G',
    },
    {
      payment_id: 'pay_2', status: 'SUCCESS',
      created_at: '2026-08-05T11:00:00.000Z',
      confirmed_at: '2026-08-05T11:00:02.000Z',
      announced_at: '2026-08-05T11:00:06.000Z',
      played_at: '2026-08-05T11:00:08.000Z',
      played_network_type: 'WIFI',
    },
    {
      payment_id: 'pay_3', status: 'SUCCESS',
      created_at: '2026-08-05T12:00:00.000Z',
      confirmed_at: '2026-08-05T12:00:01.000Z',
      announced_at: '2026-08-05T12:00:01.500Z',
    },
    {
      payment_id: 'pay_4', status: 'SUCCESS',
      created_at: '2026-08-05T13:00:00.000Z',
      confirmed_at: '2026-08-05T13:00:01.000Z',
    },
  ];

  it('computes segment percentiles, the <5s webhook->audio SLO, and delivery rate', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: payments });
    const res = await latencyHandler(event({ days: '7' }));
    expect(res.statusCode).toBe(200);
    const b = parse<any>(res);

    expect(b.target_ms).toBe(5000);
    expect(b.totals.success).toBe(4);
    expect(b.totals.announced).toBe(3);
    expect(b.totals.played).toBe(2);
    expect(b.totals.delivery_rate).toBeCloseTo(2 / 3);
    expect(b.totals.under_target_rate).toBeCloseTo(0.5); // pay_1 yes, pay_2 no

    // webhook->audio (confirmed_at -> played_at): [1500, 6000]
    expect(b.segments.webhook_to_audio.count).toBe(2);
    expect(b.segments.webhook_to_audio.p50_ms).toBe(1500);
    expect(b.segments.webhook_to_audio.p95_ms).toBe(6000);
    // initiated -> confirmed across all four: [2000, 2000, 1000, 1000]
    expect(b.segments.initiated_to_confirmed.count).toBe(4);
    // announced -> played: [1000, 2000]
    expect(b.segments.announced_to_played.p50_ms).toBe(1000);
    // end-to-end (created -> played): [3500, 8000]
    expect(b.segments.end_to_end.p95_ms).toBe(8000);
  });

  it('breaks the SLO down by network type (wifi vs mobile data)', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: payments });
    const b = parse<any>(await latencyHandler(event({ days: '7' })));

    expect(b.by_network['4G']).toMatchObject({ played: 1 });
    expect(b.by_network['4G'].p50_webhook_to_audio_ms).toBe(1500);
    expect(b.by_network['4G'].under_target_rate).toBe(1);
    expect(b.by_network['WIFI'].p50_webhook_to_audio_ms).toBe(6000);
    expect(b.by_network['WIFI'].under_target_rate).toBe(0);
  });

  it('returns a daily series for trend charts', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: payments });
    const b = parse<any>(await latencyHandler(event({ days: '7' })));
    expect(b.daily).toHaveLength(1);
    expect(b.daily[0]).toMatchObject({ date: '2026-08-05', played: 2 });
    expect(b.daily[0].under_target_rate).toBeCloseTo(0.5);
  });

  it('lists recent payments (newest first) so the portal can offer one-click tracing', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: payments });
    const b = parse<any>(await latencyHandler(event({ days: '7' })));
    expect(b.recent).toHaveLength(4);
    expect(b.recent[0].payment_id).toBe('pay_4'); // newest created_at first
    expect(b.recent.find((r: any) => r.payment_id === 'pay_1')).toMatchObject({
      webhook_to_audio_ms: 1500,
      network_type: '4G',
    });
    expect(b.recent.find((r: any) => r.payment_id === 'pay_3').webhook_to_audio_ms).toBeNull();
  });

  it('handles an empty window', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const b = parse<any>(await latencyHandler(event({ days: '1' })));
    expect(b.totals.success).toBe(0);
    expect(b.totals.delivery_rate).toBeNull();
    expect(b.segments.webhook_to_audio.p50_ms).toBeNull();
  });
});

describe('battery', () => {
  const ago = (h: number): string => new Date(Date.now() - h * 3600_000).toISOString();

  beforeEach(() => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { device_id: 'dev_1', serial_number: 'SBX-1', status: 'ACTIVE' },
        { device_id: 'dev_2', serial_number: 'SBX-2', status: 'ACTIVE' },
        { device_id: 'dev_3', serial_number: 'SBX-3', status: 'RETIRED' },
      ],
    });
    // dev_1: 100% -> 80% over 4h on 4G = 5%/hr drain
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ':d': 'dev_1' } } as never).resolves({
      Items: [
        { device_id: 'dev_1', ts: ago(4), battery: 100, network_type: '4G' },
        { device_id: 'dev_1', ts: ago(2), battery: 90, network_type: '4G' },
        { device_id: 'dev_1', ts: ago(0), battery: 80, network_type: '4G' },
      ],
    });
    // dev_2: single sample — no drain computable
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ':d': 'dev_2' } } as never).resolves({
      Items: [{ device_id: 'dev_2', ts: ago(1), battery: 95, network_type: 'WIFI' }],
    });
  });

  it('computes per-device battery series and drain rate from telemetry', async () => {
    const res = await batteryHandler(event({ hours: '24' }));
    expect(res.statusCode).toBe(200);
    const b = parse<any>(res);
    expect(b.devices).toHaveLength(2); // RETIRED excluded
    const d1 = b.devices.find((d: any) => d.device_id === 'dev_1');
    expect(d1.current_battery).toBe(80);
    expect(d1.network_type).toBe('4G');
    expect(d1.drain_pct_per_hour).toBeCloseTo(5, 0);
    expect(d1.series.map((s: any) => s.battery)).toEqual([100, 90, 80]);
    const d2 = b.devices.find((d: any) => d.device_id === 'dev_2');
    expect(d2.current_battery).toBe(95);
    expect(d2.drain_pct_per_hour).toBeNull(); // one sample
  });

  it('aggregates average drain by network type (the wifi vs mobile comparison)', async () => {
    const b = parse<any>(await batteryHandler(event({ hours: '24' })));
    expect(b.by_network['4G'].devices).toBe(1);
    expect(b.by_network['4G'].avg_drain_pct_per_hour).toBeCloseTo(5, 0);
    expect(b.by_network.WIFI).toBeUndefined(); // no computable drain -> not aggregated
  });

  it('handles devices with no telemetry at all', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const b = parse<any>(await batteryHandler(event({ hours: '24' })));
    expect(b.devices.every((d: any) => d.current_battery === null)).toBe(true);
  });
});

describe('auth attempts', () => {
  it('lists MQTT auth attempts newest first with allow/deny counts', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { device_id: 'MQTT_AUTH', ts: '2026-08-09T10:02:00.000Z#b1', username: 'vendor-test-1', client_id: 'vendor-test-1', outcome: 'DENY', reason: 'bad_password' },
        { device_id: 'MQTT_AUTH', ts: '2026-08-09T10:01:00.000Z#a1', username: 'vendor-test-1', client_id: 'vendor-test-1', outcome: 'ALLOW', reason: null },
      ],
    });
    const res = await authAttemptsHandler(event({ hours: '24' }));
    expect(res.statusCode).toBe(200);
    const b = parse<any>(res);
    expect(b.summary).toEqual({ total: 2, allowed: 1, denied: 1 });
    expect(b.attempts[0]).toMatchObject({ outcome: 'DENY', reason: 'bad_password', username: 'vendor-test-1' });
    expect(b.attempts[0].ts).toBe('2026-08-09T10:02:00.000Z'); // uniqueness suffix stripped
  });

  it('handles an empty window', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const b = parse<any>(await authAttemptsHandler(event({})));
    expect(b.summary).toEqual({ total: 0, allowed: 0, denied: 0 });
    expect(b.attempts).toEqual([]);
  });
});

describe('failures', () => {
  it('merges recent FAILED/EXPIRED and reports DLQ depths', async () => {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':st': 'FAILED' } })
      .resolves({ Items: [{ payment_id: 'pay_f', status: 'FAILED', reason: 'INSUFFICIENT_FUNDS', created_at: '2026-08-05T10:00:00Z' }] });
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':st': 'EXPIRED' } })
      .resolves({ Items: [{ payment_id: 'pay_e', status: 'EXPIRED', created_at: '2026-08-05T09:00:00Z' }] });
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '0' } });
    const res = await failuresHandler();
    expect(res.statusCode).toBe(200);
    const b = parse<any>(res);
    expect(b.recent_failures.map((x: any) => x.payment_id)).toContain('pay_f');
    expect(b.recent_failures[0].payment_id).toBe('pay_f'); // newest first
    expect(b.dlq_depths['mock-callbacks-dlq']).toBe(0);
  });
});
