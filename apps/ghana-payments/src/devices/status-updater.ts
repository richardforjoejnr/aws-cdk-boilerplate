import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';

interface HeartbeatEvent {
  device_id: string; // injected by the IoT rule SQL: topic(2) as device_id
  status?: string;
  battery?: number;
  signal?: number; // RSSI / signal quality
  network_type?: string; // WIFI | 4G | 3G | 2G
  operator?: string;
}

const NETWORKS = new Set(['WIFI', '4G', '3G', '2G', 'ETH']);

/**
 * IoT rule target for devices/+/heartbeat. PAIRED devices go ACTIVE on first
 * heartbeat; last_seen_at + connectivity (battery, network, signal) refreshed on
 * the device row, and each heartbeat is appended to the telemetry time-series
 * (TTL'd) so the observability fleet view can chart network mix / uptime.
 */
export const handler = async (event: HeartbeatEvent): Promise<void> => {
  if (!event.device_id) return;
  const now = new Date();
  const raw = event.network_type ? String(event.network_type).toUpperCase() : undefined;
  const networkType = raw ? (NETWORKS.has(raw) ? raw : 'OTHER') : undefined;

  await ddb
    .send(
      new UpdateCommand({
        TableName: process.env.DEVICES_TABLE,
        Key: { device_id: event.device_id },
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

  // Connectivity time-series (TTL 30 days). Best-effort — never fail the heartbeat.
  if (process.env.TELEMETRY_TABLE) {
    await ddb
      .send(
        new PutCommand({
          TableName: process.env.TELEMETRY_TABLE,
          Item: {
            device_id: event.device_id,
            ts: now.toISOString(),
            status: event.status ?? 'online',
            battery: event.battery ?? null,
            network_type: networkType ?? null,
            signal: event.signal ?? null,
            operator: event.operator ?? null,
            ttl: Math.floor(now.getTime() / 1000) + 30 * 24 * 3600,
          },
        })
      )
      .catch(() => undefined);
  }
};
