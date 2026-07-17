import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME, memberProfileKey } from '../shared/db.js';
import { requireUser } from '../shared/auth.js';
import type { AppSyncEvent, ParqSubmission, MemberProfile } from '../shared/types.js';

type Args = ParqSubmission;

export const handler = async (event: AppSyncEvent<Args>): Promise<MemberProfile> => {
  const user = requireUser(event.identity);
  const submission = event.arguments;
  const now = new Date().toISOString();

  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: memberProfileKey(user.userId),
      UpdateExpression:
        'SET #email = if_not_exists(#email, :email), userId = :uid, #role = if_not_exists(#role, :member), parqCompletedAt = :now, parqAnswers = :answers',
      ExpressionAttributeNames: {
        '#email': 'email',
        '#role': 'role',
      },
      ExpressionAttributeValues: {
        ':email': user.email,
        ':uid': user.userId,
        ':member': 'MEMBER',
        ':now': now,
        ':answers': submission,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes as MemberProfile;
};
