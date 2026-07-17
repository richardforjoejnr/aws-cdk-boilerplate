import {
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, classInstanceKey } from '../shared/db.js';
import { requireAdmin } from '../shared/auth.js';
import type { AppSyncEvent } from '../shared/types.js';

interface Args {
  classInstanceId: string;
  classDate: string;
}

interface Result {
  classInstanceId: string;
  cancelledBookings: number;
}

export const handler = async (event: AppSyncEvent<Args>): Promise<Result> => {
  requireAdmin(event.identity);
  const { classInstanceId, classDate } = event.arguments;

  const bookingsRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `CLASSINSTANCE#${classInstanceId}` },
    })
  );
  const activeBookings = (bookingsRes.Items ?? []).filter((item) => item.status === 'CONFIRMED');

  // TransactWriteCommand caps at 100 items. A single class won't exceed that for this studio.
  const txItems: NonNullable<TransactWriteCommandInput['TransactItems']> = activeBookings.map(
    (booking) => ({
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: booking.pk as string, sk: booking.sk as string },
        UpdateExpression: 'SET #status = :cancelled',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':cancelled': 'CANCELLED' },
      },
    })
  );
  txItems.push({
    Delete: {
      TableName: TABLE_NAME,
      Key: classInstanceKey(classDate, classInstanceId),
      ConditionExpression: 'attribute_exists(pk)',
    },
  });

  await ddb.send(new TransactWriteCommand({ TransactItems: txItems }));

  return { classInstanceId, cancelledBookings: activeBookings.length };
};
