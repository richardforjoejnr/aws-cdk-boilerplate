import type { EventBridgeEvent } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';
import { publishToDevice } from '../shared/iot.js';
import type { DeviceAnnouncement, PaymentEvent } from '../shared/types.js';
import { markAnnounced, appendEvent } from '../payments/ledger.js';
import { emitMetrics, log } from '../shared/observability.js';
import { bumpStats } from '../shared/stats.js';
import type { DeviceItem } from './handlers.js';

/**
 * Bus subscriber for payment.confirmed: find the merchant's device, take the
 * announce-once guard (ADR-4b), publish the announcement to the per-device topic.
 * The device dedupes by payment_id as well (F-3) — belt and braces.
 */
export const handler = async (
  event: EventBridgeEvent<'payment.confirmed', PaymentEvent>
): Promise<void> => {
  const { payment_id, merchant_id, amount } = event.detail;

  const res = await ddb.send(
    new QueryCommand({
      TableName: process.env.DEVICES_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'merchant_id = :m',
      ExpressionAttributeValues: { ':m': merchant_id },
    })
  );
  const device = ((res.Items ?? []) as DeviceItem[]).find(
    (d) => d.status === 'PAIRED' || d.status === 'ACTIVE'
  );
  if (!device) {
    console.log(JSON.stringify({ msg: 'no paired device for merchant', merchant_id, payment_id }));
    return;
  }

  if (!(await markAnnounced(payment_id, device.device_id))) {
    console.log(JSON.stringify({ msg: 'already announced', payment_id }));
    return;
  }

  const ghs = (amount / 100).toFixed(2);
  const announcement: DeviceAnnouncement = {
    event_type: 'ANNOUNCE_PAYMENT',
    payment_id,
    amount,
    currency: 'GHS',
    language: 'en',
    message: `Payment received, ${ghs} Ghana cedis`,
    priority: 'HIGH',
    ttl_seconds: 300,
    timestamp: new Date().toISOString(),
  };
  // The device subscribes on topics keyed by the identity it connects as: a
  // fleet-provisioned unit is its Thing name (soundbox-<serial>), a legacy
  // virtual/cert device is its device_id. Publish to whichever it uses.
  const topicRoot = device.thing_name ?? device.device_id;
  await publishToDevice(`devices/${topicRoot}/payments`, announcement);
  await appendEvent(payment_id, 'ANNOUNCEMENT_PUBLISHED', { device_id: device.device_id });

  // Observability: which soundbox served how much, and confirm->announce latency.
  const date = new Date().toISOString().slice(0, 10);
  try {
    await bumpStats(`DEVICE#${device.device_id}`, date, 'SUCCESS', amount);
  } catch (err) {
    log('warn', 'device_stats_failed', { payment_id, device_id: device.device_id, error: (err as Error).message });
  }
  const confirmedAt = Date.parse(event.detail.event_time ?? '');
  if (!Number.isNaN(confirmedAt)) {
    const ms = Date.now() - confirmedAt;
    if (ms >= 0 && ms < 600_000) {
      emitMetrics([{ name: 'AnnounceLatencyMs', value: ms, unit: 'Milliseconds' }], {}, { payment_id, merchant_id, device_id: device.device_id });
    }
  }
};
