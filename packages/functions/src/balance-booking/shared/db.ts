import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = process.env.BOOKING_TABLE_NAME!;

export const memberProfileKey = (userId: string) => ({
  pk: `MEMBER#${userId}`,
  sk: 'PROFILE',
});

export const memberBookingKey = (userId: string, bookingId: string) => ({
  pk: `MEMBER#${userId}`,
  sk: `BOOKING#${bookingId}`,
});

export const classInstanceKey = (date: string, classInstanceId: string) => ({
  pk: `CLASS#${date}`,
  sk: `INSTANCE#${classInstanceId}`,
});

export const bookingByClassKey = (classInstanceId: string, userId: string) => ({
  GSI1PK: `CLASSINSTANCE#${classInstanceId}`,
  GSI1SK: `MEMBER#${userId}`,
});
