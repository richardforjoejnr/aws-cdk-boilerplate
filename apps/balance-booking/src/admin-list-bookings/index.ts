import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../shared/db.js';
import { requireAdmin } from '../shared/auth.js';
import type { AppSyncEvent, Booking } from '../shared/types.js';

interface Args {
  classInstanceId: string;
}

export const handler = async (event: AppSyncEvent<Args>): Promise<Booking[]> => {
  requireAdmin(event.identity);
  const { classInstanceId } = event.arguments;

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `CLASSINSTANCE#${classInstanceId}` },
    })
  );

  return (res.Items ?? [])
    .filter((item) => item.status === 'CONFIRMED')
    .map((item) => ({
      bookingId: item.bookingId as string,
      userId: item.userId as string,
      classInstanceId: item.classInstanceId as string,
      classDate: item.classDate as string,
      classTypeName: item.classTypeName as string,
      startsAt: item.startsAt as string,
      status: item.status as Booking['status'],
      paymentMethod: item.paymentMethod as Booking['paymentMethod'],
      createdAt: item.createdAt as string,
    }));
};
