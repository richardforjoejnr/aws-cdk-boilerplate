import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../shared/db.js';
import { requireUser } from '../shared/auth.js';
import type { AppSyncEvent, Booking } from '../shared/types.js';

export const handler = async (event: AppSyncEvent<Record<string, never>>): Promise<Booking[]> => {
  const user = requireUser(event.identity);

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `MEMBER#${user.userId}`,
        ':skPrefix': 'BOOKING#',
      },
    })
  );

  return (res.Items ?? []).map(toBooking).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
};

function toBooking(item: Record<string, unknown>): Booking {
  return {
    bookingId: item.bookingId as string,
    userId: item.userId as string,
    classInstanceId: item.classInstanceId as string,
    classDate: item.classDate as string,
    classTypeName: item.classTypeName as string,
    startsAt: item.startsAt as string,
    status: item.status as Booking['status'],
    paymentMethod: item.paymentMethod as Booking['paymentMethod'],
    createdAt: item.createdAt as string,
  };
}
