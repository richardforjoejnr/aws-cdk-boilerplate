/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { hashSecret, credentialsHandler } from './credentials.js';
import { handler as authorize } from './custom-authorizer.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);

process.env.DEVICES_TABLE = 'test-devices';
process.env.ACCOUNT_ID = '123456789012';
process.env.AWS_REGION = 'us-east-1';

const SALT = 'a1b2c3d4e5f60708';
const PASSWORD = 'test-password-123';

const device = (over: Record<string, unknown> = {}) => ({
  device_id: 'vendor-test-1',
  serial_number: 'VENDOR-TEST-1',
  status: 'ACTIVE',
  mqtt_secret_hash: hashSecret(PASSWORD, SALT),
  mqtt_secret_salt: SALT,
  ...over,
});

/** Build the IoT enhanced-custom-auth event (password arrives base64-encoded). */
const authEvent = (username: string, password: string, clientId: string) => ({
  protocolData: {
    mqtt: { username, password: Buffer.from(password).toString('base64'), clientId },
  },
});

beforeEach(() => ddbMock.reset());

describe('MQTT custom authorizer (username/password)', () => {
  it('authenticates valid credentials and returns a policy scoped to the device topics', async () => {
    ddbMock.on(GetCommand).resolves({ Item: device() });
    const res: any = await authorize(authEvent('vendor-test-1', PASSWORD, 'vendor-test-1'));
    expect(res.isAuthenticated).toBe(true);
    expect(res.principalId).toBeTruthy();
    const statements = res.policyDocuments[0].Statement;
    const resources = statements.flatMap((s: any) => [s.Resource].flat());
    expect(resources).toContain('arn:aws:iot:us-east-1:123456789012:client/vendor-test-1');
    expect(resources).toContain('arn:aws:iot:us-east-1:123456789012:topic/devices/vendor-test-1/heartbeat');
    expect(resources).toContain('arn:aws:iot:us-east-1:123456789012:topicfilter/devices/vendor-test-1/payments');
    // no wildcard resources — least privilege
    expect(resources.some((r: string) => r.includes('*'))).toBe(false);
  });

  it('strips the x-amz-customauthorizer-name suffix from the username', async () => {
    ddbMock.on(GetCommand).resolves({ Item: device() });
    const res: any = await authorize(
      authEvent('vendor-test-1?x-amz-customauthorizer-name=pr-25-ghana-mqtt-auth', PASSWORD, 'vendor-test-1')
    );
    expect(res.isAuthenticated).toBe(true);
  });

  it('rejects a wrong password', async () => {
    ddbMock.on(GetCommand).resolves({ Item: device() });
    const res: any = await authorize(authEvent('vendor-test-1', 'wrong-password', 'vendor-test-1'));
    expect(res.isAuthenticated).toBe(false);
  });

  it('rejects an unknown device', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res: any = await authorize(authEvent('nope', PASSWORD, 'nope'));
    expect(res.isAuthenticated).toBe(false);
  });

  it('rejects a device with no credentials provisioned', async () => {
    ddbMock.on(GetCommand).resolves({ Item: device({ mqtt_secret_hash: undefined, mqtt_secret_salt: undefined }) });
    const res: any = await authorize(authEvent('vendor-test-1', PASSWORD, 'vendor-test-1'));
    expect(res.isAuthenticated).toBe(false);
  });

  it('rejects suspended and retired devices', async () => {
    for (const status of ['SUSPENDED', 'RETIRED']) {
      ddbMock.on(GetCommand).resolves({ Item: device({ status }) });
      const res: any = await authorize(authEvent('vendor-test-1', PASSWORD, 'vendor-test-1'));
      expect(res.isAuthenticated).toBe(false);
    }
  });

  it('rejects when the MQTT client id does not match the device identity', async () => {
    ddbMock.on(GetCommand).resolves({ Item: device() });
    const res: any = await authorize(authEvent('vendor-test-1', PASSWORD, 'someone-else'));
    expect(res.isAuthenticated).toBe(false);
  });

  it('scopes fleet devices to their Thing-name topics (client id = thing name)', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: device({ device_id: 'dev_9', serial_number: 'SBX-9', thing_name: 'soundbox-SBX-9' }),
    });
    const res: any = await authorize(authEvent('dev_9', PASSWORD, 'soundbox-SBX-9'));
    expect(res.isAuthenticated).toBe(true);
    const resources = res.policyDocuments[0].Statement.flatMap((s: any) => [s.Resource].flat());
    expect(resources).toContain('arn:aws:iot:us-east-1:123456789012:client/soundbox-SBX-9');
    expect(resources).toContain('arn:aws:iot:us-east-1:123456789012:topic/devices/soundbox-SBX-9/heartbeat');
  });
});

describe('credentials provisioning (POST /v1/devices/{id}/credentials)', () => {
  const event = (id: string): APIGatewayProxyEvent =>
    ({ pathParameters: { id } }) as unknown as APIGatewayProxyEvent;

  it('generates a strong password, stores only the salted hash, and returns the password once', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const res = await credentialsHandler(event('vendor-test-1'));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.username).toBe('vendor-test-1');
    expect(body.password.length).toBeGreaterThanOrEqual(24);

    const upd = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(upd.Key).toEqual({ device_id: 'vendor-test-1' });
    expect(upd.ConditionExpression).toContain('attribute_exists(device_id)');
    const vals = upd.ExpressionAttributeValues!;
    const stored = JSON.stringify(vals);
    expect(stored).not.toContain(body.password); // plaintext never stored
    expect(vals[':hash']).toBe(hashSecret(body.password, vals[':salt'] as string));
  });

  it('404s an unknown device', async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await credentialsHandler(event('nope'));
    expect(res.statusCode).toBe(404);
  });
});
