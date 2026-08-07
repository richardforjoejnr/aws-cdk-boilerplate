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

/** Concept §15 NFR: webhook -> soundbox audio must land under 5 seconds. */
const LATENCY_TARGET_MS = 5000;

interface PaymentTimes {
  payment_id?: string;
  merchant_id?: string;
  amount_pesewas?: number;
  created_at?: string;
  confirmed_at?: string;
  announced_at?: string;
  played_at?: string;
  played_network_type?: string;
}

const span = (from?: string, to?: string): number | null => {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

/** Nearest-rank percentile over an unsorted sample; null when empty. */
const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
};

const segmentStats = (values: number[]): { count: number; p50_ms: number | null; p95_ms: number | null; avg_ms: number | null } => ({
  count: values.length,
  p50_ms: percentile(values, 0.5),
  p95_ms: percentile(values, 0.95),
  avg_ms: values.length ? Math.round(values.reduce((a, v) => a + v, 0) / values.length) : null,
});

/**
 * GET /v1/observability/latency?days=7 — how fast the vendor hears the money.
 * Computed from SUCCESS payment records (GSI2) which carry the full timestamp
 * chain created_at -> confirmed_at -> announced_at -> played_at, split by the
 * network the soundbox reported when it played (Wi-Fi vs mobile data).
 */
export const latencyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(event.queryStringParameters?.days ?? '7', 10) || 7));
    const startIso = new Date(Date.now() - days * 86_400_000).toISOString();

    // Page through recent SUCCESS payments (bounded — PoC scale).
    const items: PaymentTimes[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const r = await ddb.send(
        new QueryCommand({
          TableName: PAYMENTS(),
          IndexName: 'GSI2',
          KeyConditionExpression: '#s = :st AND created_at >= :start',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':st': 'SUCCESS', ':start': startIso },
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...((r.Items ?? []) as PaymentTimes[]));
      lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey && items.length < 5000);

    const initiatedToConfirmed: number[] = [];
    const confirmedToAnnounced: number[] = [];
    const announcedToPlayed: number[] = [];
    const webhookToAudio: number[] = [];
    const endToEnd: number[] = [];
    let announced = 0;
    let played = 0;
    const byNetwork = new Map<string, { slo: number[]; delivery: number[] }>();
    const byDay = new Map<string, { slo: number[]; played: number }>();

    for (const p of items) {
      const provider = span(p.created_at, p.confirmed_at);
      if (provider !== null) initiatedToConfirmed.push(provider);
      const announce = span(p.confirmed_at, p.announced_at);
      if (announce !== null) confirmedToAnnounced.push(announce);
      if (p.announced_at) announced += 1;
      if (!p.played_at) continue;
      played += 1;

      const delivery = span(p.announced_at, p.played_at);
      if (delivery !== null) announcedToPlayed.push(delivery);
      const slo = span(p.confirmed_at, p.played_at);
      const e2e = span(p.created_at, p.played_at);
      if (e2e !== null) endToEnd.push(e2e);

      const network = p.played_network_type ?? 'UNKNOWN';
      const net = byNetwork.get(network) ?? { slo: [], delivery: [] };
      byNetwork.set(network, net);
      const day = (p.created_at ?? '').slice(0, 10);
      const daily = byDay.get(day) ?? { slo: [], played: 0 };
      byDay.set(day, daily);
      daily.played += 1;
      if (slo !== null) {
        webhookToAudio.push(slo);
        net.slo.push(slo);
        daily.slo.push(slo);
      }
      if (delivery !== null) net.delivery.push(delivery);
    }

    const underTarget = (slos: number[]): number | null =>
      slos.length ? +(slos.filter((v) => v < LATENCY_TARGET_MS).length / slos.length).toFixed(4) : null;

    const by_network: Record<string, unknown> = {};
    for (const [network, v] of byNetwork) {
      by_network[network] = {
        played: v.slo.length,
        p50_webhook_to_audio_ms: percentile(v.slo, 0.5),
        p95_webhook_to_audio_ms: percentile(v.slo, 0.95),
        p50_delivery_ms: percentile(v.delivery, 0.5),
        under_target_rate: underTarget(v.slo),
      };
    }
    const daily = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({
        date,
        played: v.played,
        p50_webhook_to_audio_ms: percentile(v.slo, 0.5),
        under_target_rate: underTarget(v.slo),
      }));

    return ok({
      days,
      target_ms: LATENCY_TARGET_MS,
      totals: {
        success: items.length,
        announced,
        played,
        delivery_rate: announced ? +(played / announced).toFixed(4) : null,
        under_target_rate: underTarget(webhookToAudio),
      },
      segments: {
        initiated_to_confirmed: segmentStats(initiatedToConfirmed),
        confirmed_to_announced: segmentStats(confirmedToAnnounced),
        announced_to_played: segmentStats(announcedToPlayed),
        webhook_to_audio: segmentStats(webhookToAudio),
        end_to_end: segmentStats(endToEnd),
      },
      by_network,
      daily,
      // Newest first, so the portal can surface payment ids for one-click tracing.
      recent: [...items]
        .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))
        .slice(0, 15)
        .map((p) => ({
          payment_id: p.payment_id ?? null,
          merchant_id: p.merchant_id ?? null,
          amount_pesewas: p.amount_pesewas ?? null,
          created_at: p.created_at ?? null,
          network_type: p.played_at ? (p.played_network_type ?? 'UNKNOWN') : null,
          webhook_to_audio_ms: span(p.confirmed_at, p.played_at),
        })),
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
          network_type: d.network_type ?? null,
          signal: d.signal ?? null,
        };
      });
    const networks: Record<string, number> = {};
    let online = 0;
    for (const d of devices) {
      if (d.online) online += 1;
      if (d.network_type) networks[String(d.network_type)] = (networks[String(d.network_type)] ?? 0) + 1;
    }
    return ok({
      summary: {
        total: devices.length,
        online,
        offline: devices.length - online,
        networks,
      },
      devices,
    });
  } catch (err) {
    return handleError(err);
  }
};
