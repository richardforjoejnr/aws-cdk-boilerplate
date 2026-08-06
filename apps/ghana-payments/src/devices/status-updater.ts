import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';
import { markPlayed } from '../payments/ledger.js';
import { emitMetrics, log } from '../shared/observability.js';

interface HeartbeatEvent {
  device_id: string; // injected by the IoT rule SQL: topic(2) as device_id
  status?: string;
  battery?: number;
  signal?: number; // RSSI / signal quality
  network_type?: string; // WIFI | 4G | 3G | 2G
  operator?: string;
  payment_id?: string; // present on {status:'played'} audio-confirmation acks
}

const NETWORKS = new Set(['WIFI', '4G', '3G', '2G', 'ETH']);

/**
 * Fleet-provisioned devices connect (and heartbeat) as their IoT Thing name,
 * soundbox-<serial> — but the devices table is keyed by device_id. Resolve via
 * the serial GSI, cached for the container lifetime (the mapping is immutable).
 */
const resolvedIds = new Map<string, string>();
async function resolveDeviceId(topicId: string): Promise<string> {
  if (!topicId.startsWith('soundbox-')) return topicId;
  const cached = resolvedIds.get(topicId);
  if (cached) return cached;
  const res = await ddb.send(
    new QueryCommand({
      TableName: process.env.DEVICES_TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: 'serial_number = :s',
      ExpressionAttributeValues: { ':s': topicId.slice('soundbox-'.length) },
      Limit: 1,
    })
  );
  const id = res.Items?.[0]?.device_id ? String(res.Items[0].device_id) : topicId;
  resolvedIds.set(topicId, id);
  return id;
}

/**
 * IoT rule target for devices/+/heartbeat. PAIRED devices go ACTIVE on first
 * heartbeat; last_seen_at + connectivity (battery, network, signal) refreshed on
 * the device row, and each heartbeat is appended to the telemetry time-series
 * (TTL'd) so the observability fleet view can chart network mix / uptime.
 *
 * A {status:'played', payment_id} ack is the device confirming the announcement
 * audio actually played: it stamps played_at on the payment (exactly-once) and
 * emits the webhook->audio / delivery latency metrics dimensioned by
 * network_type — the PoC's <5s SLO and the Wi-Fi vs mobile-data comparison.
 */
export const handler = async (event: HeartbeatEvent): Promise<void> => {
  if (!event.device_id) return;
  const now = new Date();
  const deviceId = await resolveDeviceId(event.device_id);
  const raw = event.network_type ? String(event.network_type).toUpperCase() : undefined;
  const networkType = raw ? (NETWORKS.has(raw) ? raw : 'OTHER') : undefined;

  await ddb
    .send(
      new UpdateCommand({
        TableName: process.env.DEVICES_TABLE,
        Key: { device_id: deviceId },
        UpdateExpression:
          'SET last_seen_at = :now, battery = :battery, #status = :active' +
          (networkType ? ', network_type = :net' : '') +
          (event.signal !== undefined ? ', signal = :sig' : ''),
        ConditionExpression: 'attribute_exists(device_id) AND #status IN (:paired, :active)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':now': now.toISOString(),
          ':battery': event.battery ?? null,
          ':paired': 'PAIRED',
          ':active': 'ACTIVE',
          ...(networkType ? { ':net': networkType } : {}),
          ...(event.signal !== undefined ? { ':sig': event.signal } : {}),
        },
      })
    )
    .catch((err: { name?: string }) => {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
      // unknown/suspended device heartbeat — ignore
    });

  if (event.status === 'played' && event.payment_id) {
    await recordPlayed(event.payment_id, deviceId, networkType);
  }

  // Connectivity time-series (TTL 30 days). Best-effort — never fail the heartbeat.
  if (process.env.TELEMETRY_TABLE) {
    await ddb
      .send(
        new PutCommand({
          TableName: process.env.TELEMETRY_TABLE,
          Item: {
            device_id: deviceId,
            ts: now.toISOString(),
            status: event.status ?? 'online',
            battery: event.battery ?? null,
            network_type: networkType ?? null,
            signal: event.signal ?? null,
            operator: event.operator ?? null,
            payment_id: event.payment_id ?? null,
            ttl: Math.floor(now.getTime() / 1000) + 30 * 24 * 3600,
          },
        })
      )
      .catch(() => undefined);
  }
};

const spanMs = (from: string | undefined, to: number, maxMs: number): number | undefined => {
  if (!from) return undefined;
  const ms = to - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 && ms < maxMs ? ms : undefined;
};

async function recordPlayed(
  paymentId: string,
  deviceId: string,
  networkType: string | undefined
): Promise<void> {
  let record;
  try {
    record = await markPlayed(paymentId, { deviceId, networkType });
  } catch (err) {
    log('warn', 'mark_played_failed', { payment_id: paymentId, device_id: deviceId, error: (err as Error).message });
    return;
  }
  if (!record) return; // duplicate ack or never announced — nothing to measure

  const playedAt = Date.parse(record.played_at ?? '');
  if (Number.isNaN(playedAt)) return;
  const webhookToAudio = spanMs(record.confirmed_at, playedAt, 600_000);
  const delivery = spanMs(record.announced_at, playedAt, 600_000);
  const endToEnd = spanMs(record.created_at, playedAt, 3_600_000);
  emitMetrics(
    [
      { name: 'AnnouncementPlayedCount', value: 1, unit: 'Count' },
      ...(webhookToAudio !== undefined
        ? [{ name: 'WebhookToAudioMs', value: webhookToAudio, unit: 'Milliseconds' as const }]
        : []),
      ...(delivery !== undefined
        ? [{ name: 'DeliveryLatencyMs', value: delivery, unit: 'Milliseconds' as const }]
        : []),
      ...(endToEnd !== undefined
        ? [{ name: 'EndToEndLatencyMs', value: endToEnd, unit: 'Milliseconds' as const }]
        : []),
    ],
    { network_type: networkType ?? 'UNKNOWN' },
    { payment_id: paymentId, device_id: deviceId, merchant_id: record.merchant_id }
  );
}
