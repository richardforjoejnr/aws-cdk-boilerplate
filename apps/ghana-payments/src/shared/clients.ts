import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { PaymentEvent } from './types.js';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const eventBridge = new EventBridgeClient({});

export const EVENT_SOURCE = 'ghana.payments';

export type DetailType =
  | 'payment.initiated'
  | 'payment.confirmed'
  | 'payment.failed'
  | 'payment.expired'
  | 'wallet.debited'
  | 'wallet.credited';

export async function publishEvent(detailType: DetailType, detail: PaymentEvent | Record<string, unknown>): Promise<void> {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: EVENT_SOURCE,
          DetailType: detailType,
          Detail: JSON.stringify(detail),
        },
      ],
    })
  );
}
