import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, classInstanceKey } from '../shared/db.js';
import { requireAdmin } from '../shared/auth.js';
import type { AppSyncEvent, ClassInstance } from '../shared/types.js';

interface Args {
  input: {
    classInstanceId: string;
    classDate: string;
    classTypeName?: string;
    startsAt?: string;
    durationMin?: number;
    capacity?: number;
    instructor?: string;
    priceGBP?: number;
    membersOnly?: boolean;
  };
}

export const handler = async (event: AppSyncEvent<Args>): Promise<ClassInstance> => {
  requireAdmin(event.identity);
  const { input } = event.arguments;
  const { classInstanceId, classDate, ...updates } = input;

  // Refuse to move classes across days — that changes the partition key.
  if (updates.startsAt && updates.startsAt.slice(0, 10) !== classDate) {
    throw new Error('Cannot change the date of a class. Delete and recreate it instead.');
  }

  const setClauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    setClauses.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = value;
  }

  if (setClauses.length === 0) {
    throw new Error('No fields to update');
  }

  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: classInstanceKey(classDate, classInstanceId),
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(pk)',
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes as unknown as ClassInstance;
};
