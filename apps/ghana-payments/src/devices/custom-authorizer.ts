import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { timingSafeEqual } from 'node:crypto';
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
  disconnectAfterInSeconds: 0,
  refreshAfterInSeconds: 0,
  policyDocuments: [],
};

const CONNECTABLE = new Set(['PROVISIONED', 'PAIRED', 'ACTIVE']);

export const handler = async (event: IoTCustomAuthEvent): Promise<AuthResult> => {
  const mqtt = event.protocolData?.mqtt;
  if (!mqtt?.username || !mqtt.password || !mqtt.clientId) return DENY;

  // Without a default authorizer, the authorizer name rides in the username
  // as a query suffix — strip it to recover the device id.
  const username = mqtt.username.split('?')[0];
  const password = Buffer.from(mqtt.password, 'base64').toString();

  const res = await ddb.send(
    new GetCommand({ TableName: process.env.DEVICES_TABLE, Key: { device_id: username } })
  );
  const device = res.Item as (DeviceItem & { mqtt_secret_hash?: string; mqtt_secret_salt?: string }) | undefined;
  if (!device?.mqtt_secret_hash || !device.mqtt_secret_salt) return DENY;
  if (!CONNECTABLE.has(device.status)) return DENY;

  const expected = Buffer.from(device.mqtt_secret_hash, 'hex');
  const actual = Buffer.from(hashSecret(password, device.mqtt_secret_salt), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return DENY;

  // The client id is the topic identity — it must match, so a device can never
  // claim another device's topics (mirrors the per-device cert policies).
  const topicRoot = device.thing_name ?? device.device_id;
  if (mqtt.clientId !== topicRoot) return DENY;

  const region = process.env.AWS_REGION;
  const account = process.env.ACCOUNT_ID;
  const arn = (suffix: string): string => `arn:aws:iot:${region}:${account}:${suffix}`;
  return {
    isAuthenticated: true,
    principalId: `device-${device.device_id}`.replace(/[^a-zA-Z0-9\-_]/g, '-'),
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
