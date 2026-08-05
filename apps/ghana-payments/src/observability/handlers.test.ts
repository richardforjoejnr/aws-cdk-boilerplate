/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { overviewHandler, traceHandler, failuresHandler, fleetHandler } from './handlers.js';

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
  it('reports online/offline, network mix and battery', async () => {
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
    expect(b.summary.avg_battery).toBe(60);
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
