import { randomUUID } from 'node:crypto';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, classInstanceKey } from '../shared/db.js';
import type { ClassInstance } from '../shared/types.js';

const CATALOGUE: Array<Omit<ClassInstance, 'classInstanceId' | 'startsAt' | 'booked'>> = [
  {
    classTypeSlug: 'reformer-flow-it',
    classTypeName: 'Reformer — Flow It',
    level: 'L1',
    format: 'REFORMER',
    durationMin: 45,
    capacity: 8,
    instructor: 'Franki',
    priceGBP: 20,
  },
  {
    classTypeSlug: 'reformer-pace-it',
    classTypeName: 'Reformer — Pace It',
    level: 'L2',
    format: 'REFORMER',
    durationMin: 45,
    capacity: 8,
    instructor: 'Franki',
    priceGBP: 20,
  },
  {
    classTypeSlug: 'reformer-werk-it',
    classTypeName: 'Reformer — Werk It',
    level: 'L3',
    format: 'REFORMER',
    durationMin: 45,
    capacity: 8,
    instructor: 'Franki',
    priceGBP: 20,
  },
  {
    classTypeSlug: 'simmer-it',
    classTypeName: 'Infrared Mat — Simmer It',
    level: 'L1',
    format: 'INFRARED_MAT',
    durationMin: 45,
    capacity: 12,
    instructor: 'Franki',
    priceGBP: 12,
  },
  {
    classTypeSlug: 'barre',
    classTypeName: 'Barre Pilates',
    level: 'ALL',
    format: 'BARRE',
    durationMin: 45,
    capacity: 12,
    instructor: 'Franki',
    priceGBP: 10,
  },
];

const SLOTS = [
  { hour: 9, minute: 30 },
  { hour: 17, minute: 30 },
  { hour: 18, minute: 30 },
];

export const handler = async (): Promise<{ created: number }> => {
  const today = new Date();
  const items: Array<{ PutRequest: { Item: Record<string, unknown> } }> = [];

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = new Date(today);
    date.setDate(today.getDate() + dayOffset);
    if (date.getDay() === 0) continue;
    const dateStr = date.toISOString().slice(0, 10);

    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      const template = CATALOGUE[(dayOffset + i) % CATALOGUE.length];
      const startsAt = `${dateStr}T${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}:00.000Z`;
      const classInstanceId = randomUUID();

      items.push({
        PutRequest: {
          Item: {
            ...classInstanceKey(dateStr, classInstanceId),
            classInstanceId,
            ...template,
            startsAt,
            booked: 0,
          },
        },
      });
    }
  }

  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: batch } }));
  }

  return { created: items.length };
};
