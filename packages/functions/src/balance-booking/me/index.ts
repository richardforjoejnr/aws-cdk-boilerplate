import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, memberProfileKey } from '../shared/db.js';
import { requireUser } from '../shared/auth.js';
import type { AppSyncEvent, MemberProfile } from '../shared/types.js';

export const handler = async (
  event: AppSyncEvent<Record<string, never>>
): Promise<MemberProfile> => {
  const user = requireUser(event.identity);

  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: memberProfileKey(user.userId) })
  );

  if (res.Item) {
    return res.Item as MemberProfile;
  }

  return {
    userId: user.userId,
    email: user.email,
    name: user.email.split('@')[0],
    role: 'MEMBER',
  };
};
