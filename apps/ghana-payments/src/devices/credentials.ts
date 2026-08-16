import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes, scryptSync } from 'node:crypto';
import { ddb } from '../shared/clients.js';
import { apiError, handleError, ok } from '../shared/http.js';

/** Salted scrypt hash for device MQTT passwords (custom authorizer auth). */
export function hashSecret(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

/**
 * POST /v1/devices/{id}/credentials (admin) — provision or rotate the MQTT
 * username/password for a device, for hardware that can't do X.509 client
 * certificates. Username is the device_id; the password is returned exactly
 * once and only its salted hash is stored. Re-invoking rotates the password.
 */
export const credentialsHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const deviceId = event.pathParameters?.id;
    if (!deviceId) return apiError(400, 'MISSING_ID', 'device id required');

    const password = randomBytes(24).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.DEVICES_TABLE,
          Key: { device_id: deviceId },
          UpdateExpression:
            'SET mqtt_secret_hash = :hash, mqtt_secret_salt = :salt, mqtt_secret_created_at = :now',
          ConditionExpression: 'attribute_exists(device_id)',
          ExpressionAttributeValues: {
            ':hash': hashSecret(password, salt),
            ':salt': salt,
            ':now': new Date().toISOString(),
          },
        })
      );
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return apiError(404, 'NOT_FOUND', 'No such device');
      }
      throw err;
    }
    return ok(
      {
        username: deviceId,
        password,
        note: 'Shown once — store it now. Re-invoking this endpoint rotates the password.',
      },
      201
    );
  } catch (err) {
    return handleError(err);
  }
};
