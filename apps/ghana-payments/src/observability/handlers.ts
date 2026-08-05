import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ddb } from '../shared/clients.js';
import { ok, apiError, handleError } from '../shared/http.js';

const METRICS = (): string => process.env.METRICS_TABLE ?? '';
const PAYMENTS = (): string => process.env.PAYMENTS_TABLE ?? '';
const DEVICES = (): string => process.env.DEVICES_TABLE ?? '';
const sqs = new SQSClient({});

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

interface StatRow {
  pk: string;
  date: string;
  txn_count?: number;
  volume_pesewas?: number;
  success_count?: number;
  failed_count?: number;
  expired_count?: number;
}

/** GET /v1/observability/overview?days=7 — usage & value: volume, success, top merchants. */
export const overviewHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(event.queryStringParameters?.days ?? '7', 10) || 7));
    const start = new Date(Date.now() - (days - 1) * 86_400_000);
    const startDate = isoDate(start);

    // Daily totals (pk = TOTAL)
    const totalsRes = await ddb.send(
      new QueryCommand({
        TableName: METRICS(),
        KeyConditionExpression: 'pk = :t AND #d >= :start',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':t': 'TOTAL', ':start': startDate },
      })
    );
    const daily = ((totalsRes.Items ?? []) as StatRow[]).map((r) => ({
      date: r.date,
      transactions: num(r.txn_count),
      volume_pesewas: num(r.volume_pesewas),
      success: num(r.success_count),
      failed: num(r.failed_count),
      expired: num(r.expired_count),
    }));
    const totals = daily.reduce(
      (a, d) => ({
        transactions: a.transactions + d.transactions,
        volume_pesewas: a.volume_pesewas + d.volume_pesewas,
        success: a.success + d.success,
        failed: a.failed + d.failed,
        expired: a.expired + d.expired,
      }),
      { transactions: 0, volume_pesewas: 0, success: 0, failed: 0, expired: 0 }
    );
    const successRate = totals.transactions ? +(totals.success / totals.transactions).toFixed(4) : null;

    // Top merchants + soundboxes by volume (scan MERCHANT#/DEVICE# rows in range — small at PoC scale)
    const rollupRes = await ddb.send(
      new ScanCommand({
        TableName: METRICS(),
        FilterExpression: '(begins_with(pk, :m) OR begins_with(pk, :dev)) AND #d >= :start',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':m': 'MERCHANT#', ':dev': 'DEVICE#', ':start': startDate },
      })
    );
    const agg = new Map<string, { volume: number; count: number }>();
    for (const r of (rollupRes.Items ?? []) as StatRow[]) {
      const cur = agg.get(r.pk) ?? { volume: 0, count: 0 };
      cur.volume += num(r.volume_pesewas);
      cur.count += num(r.txn_count);
      agg.set(r.pk, cur);
    }
    const rank = (prefix: string): { id: string; volume_pesewas: number; transactions: number }[] =>
      [...agg.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ id: k.slice(prefix.length), volume_pesewas: v.volume, transactions: v.count }))
        .sort((a, b) => b.volume_pesewas - a.volume_pesewas)
        .slice(0, 5);

    return ok({
      days,
      totals,
      success_rate: successRate,
      daily,
      top_merchants: rank('MERCHANT#'),
      top_soundboxes: rank('DEVICE#'),
    });
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/observability/trace/{payment_id} — the full lifecycle with per-stage latency. */
export const traceHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const paymentId = event.pathParameters?.payment_id;
    if (!paymentId) return apiError(400, 'MISSING_ID', 'payment_id required');
    const res = await ddb.send(
      new QueryCommand({
        TableName: PAYMENTS(),
        KeyConditionExpression: 'payment_id = :p',
        ExpressionAttributeValues: { ':p': paymentId },
      })
    );
    const items = (res.Items ?? []) as Record<string, unknown>[];
    if (items.length === 0) return apiError(404, 'NOT_FOUND', 'No such payment');
    const meta = items.find((i) => i.sk === 'META') ?? {};

    // EVT#<iso>#<id> rows → ordered timeline; latency = gap from the previous step.
    const events = items
      .filter((i) => typeof i.sk === 'string' && i.sk.startsWith('EVT#'))
      .map((i) => ({ event_type: String(i.event_type ?? 'EVENT'), ts: (i.sk as string).split('#')[1] }))
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    let prev: number | null = null;
    const timeline = events.map((e) => {
      const t = Date.parse(e.ts);
      const delta = prev === null ? 0 : t - prev;
      prev = t;
      return { event_type: e.event_type, ts: e.ts, delta_ms: delta };
    });
    const totalMs = timeline.length ? Date.parse(timeline[timeline.length - 1].ts) - Date.parse(timeline[0].ts) : 0;

    return ok({
      payment_id: paymentId,
      merchant_id: meta.merchant_id ?? null,
      amount_pesewas: meta.amount_pesewas ?? null,
      status: meta.status ?? null,
      created_at: meta.created_at ?? null,
      confirmed_at: meta.confirmed_at ?? null,
      total_ms: totalMs,
      timeline,
    });
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/observability/failures — recent failed/expired payments + DLQ backlog. */
export const failuresHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const recent = async (status: string): Promise<Record<string, unknown>[]> => {
      const r = await ddb.send(
        new QueryCommand({
          TableName: PAYMENTS(),
          IndexName: 'GSI2',
          KeyConditionExpression: '#s = :st',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':st': status },
          ScanIndexForward: false,
          Limit: 15,
        })
      );
      return (r.Items ?? []) as Record<string, unknown>[];
    };
    const [failed, expired] = await Promise.all([recent('FAILED'), recent('EXPIRED')]);
    const failures = [...failed, ...expired]
      .map((p) => ({
        payment_id: p.payment_id,
        merchant_id: p.merchant_id ?? null,
        amount_pesewas: p.amount_pesewas ?? null,
        status: p.status,
        reason: p.reason ?? p.status_reason ?? null,
        created_at: p.created_at ?? null,
      }))
      .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))
      .slice(0, 25);

    // DLQ backlog — a stuck consumer.
    const stage = process.env.STAGE ?? 'dev';
    const region = process.env.AWS_REGION;
    const account = process.env.ACCOUNT_ID;
    const dlqs = ['mock-callbacks-dlq', 'announcer-dlq', 'credit-back-dlq', 'audit-dlq'];
    const dlq_depths: Record<string, number> = {};
    await Promise.all(
      dlqs.map(async (name) => {
        try {
          const url = `https://sqs.${region}.amazonaws.com/${account}/${stage}-ghana-${name}`;
          const attr = await sqs.send(
            new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages'] })
          );
          dlq_depths[name] = parseInt(attr.Attributes?.ApproximateNumberOfMessages ?? '0', 10);
        } catch {
          dlq_depths[name] = -1; // unknown
        }
      })
    );

    return ok({ recent_failures: failures, dlq_depths });
  } catch (err) {
    return handleError(err);
  }
};

/** GET /v1/observability/fleet — device online/offline, battery, network mix. */
export const fleetHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const res = await ddb.send(new ScanCommand({ TableName: DEVICES() }));
    const nowMs = Date.now();
    const ONLINE_MS = 5 * 60_000;
    const devices = ((res.Items ?? []) as Record<string, unknown>[])
      .filter((d) => d.status !== 'RETIRED')
      .map((d) => {
        const lastSeen = d.last_seen_at ? Date.parse(String(d.last_seen_at)) : 0;
        return {
          device_id: d.device_id,
          serial_number: d.serial_number,
          status: d.status,
          merchant_id: d.merchant_id ?? null,
          online: lastSeen > 0 && nowMs - lastSeen < ONLINE_MS,
          last_seen_at: d.last_seen_at ?? null,
          battery: d.battery ?? null,
          network_type: d.network_type ?? null,
          signal: d.signal ?? null,
        };
      });
    const networks: Record<string, number> = {};
    let online = 0;
    let batterySum = 0;
    let batteryN = 0;
    for (const d of devices) {
      if (d.online) online += 1;
      if (d.network_type) networks[String(d.network_type)] = (networks[String(d.network_type)] ?? 0) + 1;
      if (typeof d.battery === 'number') {
        batterySum += d.battery;
        batteryN += 1;
      }
    }
    return ok({
      summary: {
        total: devices.length,
        online,
        offline: devices.length - online,
        networks,
        avg_battery: batteryN ? Math.round(batterySum / batteryN) : null,
      },
      devices,
    });
  } catch (err) {
    return handleError(err);
  }
};
