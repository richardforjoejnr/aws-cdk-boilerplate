import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { _resetConfigCache } from '../shared/config.js';
import { generateHandler, resolveHandler } from './handlers.js';

const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);
const ssmMock = mockClient(SSMClient);

process.env.QR_CODES_TABLE = 'test-qr';
process.env.MERCHANTS_TABLE = 'test-merchants';
process.env.STAGE = 'dev';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;

interface QrResponse { qr_id: string; payload_url: string; png_base64: string; merchant_name?: string }
interface ErrorResponse { error: { code: string; message: string } }

const event = (pathParameters: Record<string, string>): APIGatewayProxyEvent =>
  ({ pathParameters, body: null }) as unknown as APIGatewayProxyEvent;

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  _resetConfigCache();
  ssmMock.on(GetParametersByPathCommand).resolves({
    Parameters: [{ Name: '/dev/ghana-payments/public-base-url', Value: 'https://demo.cloudfront.net' }],
  });
});

describe('QR generate (D3)', () => {
  it('creates a QR whose payload URL is {PUBLIC_BASE_URL}/pay/{qr_id} and returns a PNG', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock.on(PutCommand).resolves({});
    const res = await generateHandler(event({ id: 'mer_1' }));
    expect(res.statusCode).toBe(201);
    const body = parse<QrResponse>(res);
    expect(body.payload_url).toBe(`https://demo.cloudfront.net/pay/${body.qr_id}`);
    expect(body.png_base64.length).toBeGreaterThan(500);
    expect(Buffer.from(body.png_base64, 'base64').subarray(1, 4).toString()).toBe('PNG');
  });

  it('404s for a missing merchant', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await generateHandler(event({ id: 'mer_x' }));
    expect(res.statusCode).toBe(404);
  });
});

describe('QR resolve (anti-tamper check, §12.1)', () => {
  it('returns merchant name for ACTIVE qr + ACTIVE merchant', async () => {
    ddbMock
      .on(GetCommand, { TableName: 'test-qr' })
      .resolves({ Item: { qr_id: 'qr_1', merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', display_name: 'Ama', status: 'ACTIVE', business_category: 'food' } });
    const res = await resolveHandler(event({ qr_id: 'qr_1' }));
    expect(res.statusCode).toBe(200);
    expect(parse<QrResponse>(res).merchant_name).toBe('Ama');
  });

  it('410s a ROTATED qr (compromised badge does not resolve)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { qr_id: 'qr_1', merchant_id: 'mer_1', status: 'ROTATED' } });
    const res = await resolveHandler(event({ qr_id: 'qr_1' }));
    expect(res.statusCode).toBe(410);
    expect(parse<ErrorResponse>(res).error.code).toBe('QR_INACTIVE');
  });

  it('410s when the merchant behind an active QR is suspended', async () => {
    ddbMock
      .on(GetCommand, { TableName: 'test-qr' })
      .resolves({ Item: { qr_id: 'qr_1', merchant_id: 'mer_1', status: 'ACTIVE' } });
    ddbMock
      .on(GetCommand, { TableName: 'test-merchants' })
      .resolves({ Item: { merchant_id: 'mer_1', display_name: 'Ama', status: 'SUSPENDED' } });
    const res = await resolveHandler(event({ qr_id: 'qr_1' }));
    expect(res.statusCode).toBe(410);
    expect(parse<ErrorResponse>(res).error.code).toBe('MERCHANT_INACTIVE');
  });
});
