import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ddb } from '../shared/clients.js';
import { hashSecret } from './credentials.js';
import type { DeviceItem } from './handlers.js';

/**
 * AWS IoT custom authorizer (enhanced custom auth): username/password in the
 * MQTT CONNECT packet, for soundbox hardware that can't hold X.509 client
 * certificates. Devices connect on port 443 with TLS + ALPN "mqtt".
 *
 * Username = device_id; password verified against the salted scrypt hash
 * provisioned via POST /v1/devices/{id}/credentials. The MQTT client id must
 * be the device's topic identity (thing_name for fleet units, else device_id),
 * and the returned policy is scoped to exactly that device's three topics —
 * same least-privilege shape as the per-device certificate policies.
 */

interface IoTCustomAuthEvent {
  protocolData?: {
    mqtt?: { username?: string; password?: string; clientId?: string };
  };
}

interface AuthResult {
  isAuthenticated: boolean;
  principalId: string;
  disconnectAfterInSeconds: number;
  refreshAfterInSeconds: number;
  policyDocuments: Record<string, unknown>[];
}

const DENY: AuthResult = {
  isAuthenticated: false,
  principalId: 'denied',
  disconnectAfterInSeconds: 300, // AWS minimum — values below invalidate the response
  refreshAfterInSeconds: 300,
  policyDocuments: [],
};

const CONNECTABLE = new Set(['PROVISIONED', 'PAIRED', 'ACTIVE']);

/**
 * Auth-attempt audit row for the observability UI (single MQTT_AUTH partition
 * in the telemetry table, TTL 30 days). Best-effort — never fails the auth
 * decision, and never stores password material.
 */
async function audit(
  username: string,
  clientId: string,
  outcome: 'ALLOW' | 'DENY',
  reason: string | null
): Promise<void> {
  if (!process.env.TELEMETRY_TABLE) return;
  const now = new Date();
  await ddb
    .send(
      new PutCommand({
        TableName: process.env.TELEMETRY_TABLE,
        Item: {
          device_id: 'MQTT_AUTH',
          ts: `${now.toISOString()}#${randomUUID().slice(0, 4)}`,
          username,
          client_id: clientId,
          outcome,
          reason,
          ttl: Math.floor(now.getTime() / 1000) + 30 * 24 * 3600,
        },
      })
    )
    .catch(() => undefined);
}

export const handler = async (event: IoTCustomAuthEvent): Promise<AuthResult> => {
  const mqtt = event.protocolData?.mqtt;
  if (!mqtt?.username || !mqtt.password || !mqtt.clientId) return DENY;

  // Without a default authorizer, the authorizer name rides in the username
  // as a query suffix — strip it to recover the device id.
  const username = mqtt.username.split('?')[0];
  const password = Buffer.from(mqtt.password, 'base64').toString();
  const deny = async (reason: string): Promise<AuthResult> => {
    await audit(username, mqtt.clientId ?? '', 'DENY', reason);
    return DENY;
  };

  const res = await ddb.send(
    new GetCommand({ TableName: process.env.DEVICES_TABLE, Key: { device_id: username } })
  );
  const device = res.Item as (DeviceItem & { mqtt_secret_hash?: string; mqtt_secret_salt?: string }) | undefined;
  if (!device) return deny('unknown_device');
  if (!device.mqtt_secret_hash || !device.mqtt_secret_salt) return deny('no_credentials');
  if (!CONNECTABLE.has(device.status)) return deny(`status_${device.status.toLowerCase()}`);

  const expected = Buffer.from(device.mqtt_secret_hash, 'hex');
  const actual = Buffer.from(hashSecret(password, device.mqtt_secret_salt), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return deny('bad_password');
  }

  // The client id is the topic identity — it must match, so a device can never
  // claim another device's topics (mirrors the per-device cert policies).
  const topicRoot = device.thing_name ?? device.device_id;
  if (mqtt.clientId !== topicRoot) return deny('client_id_mismatch');

  await audit(username, mqtt.clientId, 'ALLOW', null);

  const region = process.env.AWS_REGION;
  const account = process.env.ACCOUNT_ID;
  const arn = (suffix: string): string => `arn:aws:iot:${region}:${account}:${suffix}`;
  return {
    isAuthenticated: true,
    // Strictly alphanumeric per AWS: ([a-zA-Z0-9]){1,128} — hyphens/underscores
    // in the response invalidate it and the broker silently disconnects.
    principalId: `device${device.device_id}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 128),
    disconnectAfterInSeconds: 86_400,
    refreshAfterInSeconds: 300,
    policyDocuments: [
      {
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Action: 'iot:Connect', Resource: arn(`client/${topicRoot}`) },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: [
              arn(`topicfilter/devices/${topicRoot}/payments`),
              arn(`topicfilter/devices/${topicRoot}/commands`),
            ],
          },
          {
            Effect: 'Allow',
            Action: 'iot:Receive',
            Resource: [
              arn(`topic/devices/${topicRoot}/payments`),
              arn(`topic/devices/${topicRoot}/commands`),
            ],
          },
          { Effect: 'Allow', Action: 'iot:Publish', Resource: arn(`topic/devices/${topicRoot}/heartbeat`) },
        ],
      },
    ],
  };
};
