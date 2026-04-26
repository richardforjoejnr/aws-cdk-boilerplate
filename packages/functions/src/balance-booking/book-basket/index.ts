import { randomUUID } from 'node:crypto';
import {
  TransactWriteCommand,
  GetCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  ddb,
  TABLE_NAME,
  memberProfileKey,
  memberBookingKey,
  classInstanceKey,
} from '../shared/db.js';
import { requireUser } from '../shared/auth.js';
import type { AppSyncEvent, BasketItem, Booking } from '../shared/types.js';

interface Args {
  items: BasketItem[];
  voucherCode?: string;
}

interface BookBasketResult {
  bookings: Booking[];
  totalGBP: number;
  paymentMethod: 'STUB';
}

export const handler = async (event: AppSyncEvent<Args>): Promise<BookBasketResult> => {
  const user = requireUser(event.identity);
  const { items } = event.arguments;

  if (!items?.length) {
    throw new Error('Basket is empty');
  }

  const profile = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: memberProfileKey(user.userId) })
  );
  if (!profile.Item?.parqCompletedAt) {
    throw new Error('PAR-Q must be completed before booking');
  }

  const bookings: Booking[] = [];
  let totalGBP = 0;
  const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [];

  for (const { classInstanceId, classDate } of items) {
    // classDate comes from the client (it's already in ClassInstance.startsAt). The class row
    // is the source of truth for capacity & price — we re-read it inside the transaction.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(classDate)) {
      throw new Error(`Invalid classDate "${classDate}" for ${classInstanceId}`);
    }
    const classKey = classInstanceKey(classDate, classInstanceId);

    const classRow = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: classKey }));
    if (!classRow.Item) {
      throw new Error(`Class ${classInstanceId} not found on ${classDate}`);
    }
    const capacity = classRow.Item.capacity as number;
    const booked = (classRow.Item.booked as number) ?? 0;
    if (booked >= capacity) {
      throw new Error(`Class "${classRow.Item.classTypeName}" is full`);
    }

    const bookingId = randomUUID();
    const booking: Booking = {
      bookingId,
      userId: user.userId,
      classInstanceId,
      classDate,
      classTypeName: classRow.Item.classTypeName as string,
      startsAt: classRow.Item.startsAt as string,
      status: 'CONFIRMED',
      paymentMethod: 'STUB',
      createdAt: new Date().toISOString(),
    };

    bookings.push(booking);
    totalGBP += (classRow.Item.priceGBP as number) ?? 0;

    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          ...memberBookingKey(user.userId, bookingId),
          GSI1PK: `CLASSINSTANCE#${classInstanceId}`,
          GSI1SK: `MEMBER#${user.userId}`,
          ...booking,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    });
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: classKey,
        // if_not_exists() is allowed in UpdateExpression but NOT in ConditionExpression.
        // The condition must rely on attribute_(not_)exists or direct comparisons. Seed-classes
        // and admin-create-class always set booked=0 at creation, so the OR is just a defensive
        // fallback for any class that ever lands without the attribute.
        UpdateExpression: 'SET #booked = if_not_exists(#booked, :zero) + :one',
        ConditionExpression: 'attribute_not_exists(#booked) OR #booked < #capacity',
        ExpressionAttributeNames: { '#booked': 'booked', '#capacity': 'capacity' },
        ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return { bookings, totalGBP, paymentMethod: 'STUB' };
};
