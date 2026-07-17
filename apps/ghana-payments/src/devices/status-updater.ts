import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';

interface HeartbeatEvent {
  device_id: string; // injected by the IoT rule SQL: topic(2) as device_id
  status?: string;
  battery?: number;
  signal?: number;
}

/**
 * IoT rule target for devices/+/heartbeat: PAIRED devices go ACTIVE on first
 * heartbeat; last_seen_at always refreshed. OFFLINE detection (stale heartbeat
 * sweep / lifecycle events) is post-PoC.
 */
export const handler = async (event: HeartbeatEvent): Promise<void> => {
  if (!event.device_id) return;
  await ddb
    .send(
      new UpdateCommand({
        TableName: process.env.DEVICES_TABLE,
        Key: { device_id: event.device_id },
        UpdateExpression: 'SET last_seen_at = :now, battery = :battery, #status = :active',
        ConditionExpression: 'attribute_exists(device_id) AND #status IN (:paired, :active)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
          ':battery': event.battery ?? null,
          ':paired': 'PAIRED',
          ':active': 'ACTIVE',
        },
      })
    )
    .catch((err: { name?: string }) => {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
      // unknown/suspended device heartbeat — ignore
    });
};
