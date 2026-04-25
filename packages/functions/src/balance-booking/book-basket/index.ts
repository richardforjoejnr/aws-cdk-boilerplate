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

  for (const { classInstanceId } of items) {
    const classDate = await findClassDate(classInstanceId);
    const classKey = classInstanceKey(classDate, classInstanceId);

    const classRow = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: classKey }));
    if (!classRow.Item) {
      throw new Error(`Class ${classInstanceId} not found`);
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
        UpdateExpression: 'SET booked = if_not_exists(booked, :zero) + :one',
        ConditionExpression: 'if_not_exists(booked, :zero) < capacity',
        ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return { bookings, totalGBP, paymentMethod: 'STUB' };
};

async function findClassDate(classInstanceId: string): Promise<string> {
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: classInstanceKey(date, classInstanceId) })
    );
    if (res.Item) return date;
  }
  throw new Error(`Class instance ${classInstanceId} not found in next 60 days`);
}
