import { randomUUID } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, classInstanceKey } from '../shared/db.js';
import { requireAdmin } from '../shared/auth.js';
import type { AppSyncEvent, ClassInstance } from '../shared/types.js';

interface Args {
  classTypeSlug: string;
  classTypeName: string;
  level: ClassInstance['level'];
  format: ClassInstance['format'];
  startsAt: string;
  durationMin: number;
  capacity: number;
  instructor: string;
  priceGBP: number;
  membersOnly?: boolean;
}

export const handler = async (event: AppSyncEvent<Args>): Promise<ClassInstance> => {
  requireAdmin(event.identity);
  const args = event.arguments;
  const classInstanceId = randomUUID();
  const classDate = args.startsAt.slice(0, 10);

  const instance: ClassInstance = {
    classInstanceId,
    classTypeSlug: args.classTypeSlug,
    classTypeName: args.classTypeName,
    level: args.level,
    format: args.format,
    startsAt: args.startsAt,
    durationMin: args.durationMin,
    capacity: args.capacity,
    booked: 0,
    instructor: args.instructor,
    priceGBP: args.priceGBP,
    membersOnly: args.membersOnly,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...classInstanceKey(classDate, classInstanceId), ...instance },
      ConditionExpression: 'attribute_not_exists(pk)',
    })
  );

  return instance;
};
