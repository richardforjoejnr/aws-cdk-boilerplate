import type { EventBridgeEvent } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { ddb } from '../shared/clients.js';

/** Subscribes to every ghana.payments bus event and writes the audit trail (D9), TTL 90 days. */
export const handler = async (
  event: EventBridgeEvent<string, Record<string, unknown>>
): Promise<void> => {
  const now = new Date();
  await ddb.send(
    new PutCommand({
      TableName: process.env.AUDIT_TABLE,
      Item: {
        date: now.toISOString().slice(0, 10),
        sk: `${now.toISOString()}#${randomUUID().slice(0, 8)}`,
        detail_type: event['detail-type'],
        source: event.source,
        detail: event.detail,
        ttl: Math.floor(now.getTime() / 1000) + 90 * 24 * 3600,
      },
    })
  );
};
