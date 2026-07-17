import { TransactWriteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, memberBookingKey, classInstanceKey } from '../shared/db.js';
import { requireUser } from '../shared/auth.js';
import type { AppSyncEvent, Booking } from '../shared/types.js';

interface Args {
  bookingId: string;
}

export const handler = async (event: AppSyncEvent<Args>): Promise<Booking> => {
  const user = requireUser(event.identity);
  const { bookingId } = event.arguments;

  const bookingKey = memberBookingKey(user.userId, bookingId);
  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: bookingKey }));
  if (!existing.Item) throw new Error('Booking not found');
  if (existing.Item.status === 'CANCELLED') throw new Error('Already cancelled');

  const classDate = existing.Item.classDate as string;
  const classInstanceId = existing.Item.classInstanceId as string;

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: bookingKey,
            UpdateExpression: 'SET #status = :cancelled',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':cancelled': 'CANCELLED' },
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: classInstanceKey(classDate, classInstanceId),
            UpdateExpression: 'SET booked = booked - :one',
            ConditionExpression: 'booked > :zero',
            ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
          },
        },
      ],
    })
  );

  return { ...(existing.Item as Booking), status: 'CANCELLED' };
};
