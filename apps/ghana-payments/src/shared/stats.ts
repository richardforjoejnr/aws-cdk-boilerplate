import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './clients.js';

const TABLE = (): string => process.env.METRICS_TABLE ?? '';

/**
 * Atomically roll up a transaction into a daily counter row. High-cardinality
 * usage stats (per merchant, per device) live here rather than as CloudWatch
 * metric dimensions, which keeps monitoring cheap at fleet scale.
 * pk = TOTAL | MERCHANT#<id> | DEVICE#<id> ; sk = yyyy-mm-dd.
 */
export async function bumpStats(
  pk: string,
  date: string,
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED',
  amountPesewas: number
): Promise<void> {
  if (!TABLE()) return;
  const statusAttr =
    status === 'SUCCESS' ? 'success_count' : status === 'FAILED' ? 'failed_count' : 'expired_count';
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { pk, date },
      UpdateExpression: 'ADD txn_count :one, volume_pesewas :vol, #s :one',
      ExpressionAttributeNames: { '#s': statusAttr },
      ExpressionAttributeValues: { ':one': 1, ':vol': status === 'SUCCESS' ? amountPesewas : 0 },
    })
  );
}
