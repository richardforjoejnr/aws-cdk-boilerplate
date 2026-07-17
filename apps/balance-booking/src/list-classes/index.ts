import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../shared/db.js';
import type { AppSyncEvent, ClassInstance } from '../shared/types.js';

interface Args {
  fromDate?: string;
  toDate?: string;
}

export const handler = async (event: AppSyncEvent<Args>): Promise<ClassInstance[]> => {
  const today = new Date().toISOString().slice(0, 10);
  const from = event.arguments.fromDate ?? today;
  const to = event.arguments.toDate ?? addDays(from, 14);

  const dates = datesBetween(from, to);
  const results: ClassInstance[] = [];

  for (const date of dates) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `CLASS#${date}`,
          ':skPrefix': 'INSTANCE#',
        },
      })
    );
    for (const item of res.Items ?? []) {
      results.push(toClassInstance(item));
    }
  }

  results.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return results;
};

function datesBetween(from: string, to: string): string[] {
  const result: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function toClassInstance(item: Record<string, unknown>): ClassInstance {
  return {
    classInstanceId: item.classInstanceId as string,
    classTypeSlug: item.classTypeSlug as string,
    classTypeName: item.classTypeName as string,
    level: item.level as ClassInstance['level'],
    format: item.format as ClassInstance['format'],
    startsAt: item.startsAt as string,
    durationMin: item.durationMin as number,
    capacity: item.capacity as number,
    booked: (item.booked as number) ?? 0,
    instructor: item.instructor as string,
    priceGBP: item.priceGBP as number,
    membersOnly: item.membersOnly as boolean | undefined,
  };
}
