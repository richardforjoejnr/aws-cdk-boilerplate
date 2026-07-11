import { mockClient } from 'aws-sdk-client-mock';
import { APIGatewayClient, GetApiKeysCommand } from '@aws-sdk/client-api-gateway';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { hashPii } from '../shared/pii.js';
import { tokenHandler } from './handlers.js';

const ssmMock = mockClient(SSMClient);
const apigwMock = mockClient(APIGatewayClient);

process.env.ADMIN_CREDS_PARAM = '/dev/ghana-payments/admin-creds';
process.env.ADMIN_API_KEY_NAME = 'dev-ghana-admin-key';

const parse = <T>(res: { body: string }): T => JSON.parse(res.body) as T;

interface TokenResponse {
  api_key: string;
}
interface ErrorResponse {
  error: { code: string };
}

const event = (body: Record<string, unknown>): APIGatewayProxyEvent =>
  ({ pathParameters: {}, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;

const storedCreds = JSON.stringify({
  username: 'admin',
  password_hash: hashPii('correct-horse'),
});

beforeEach(() => {
  ssmMock.reset();
  apigwMock.reset();
  ssmMock
    .on(GetParameterCommand)
    .resolves({ Parameter: { Value: storedCreds } });
  apigwMock
    .on(GetApiKeysCommand)
    .resolves({ items: [{ id: 'key-id', value: 'da2-secret-key-value' }] });
});

// NOTE: the handler caches credentials at module level with no reset seam, so the
// "SSM unavailable" case MUST run before any successful credential load in this file.
describe('portal sign-in (auth/handlers)', () => {
  it('SSM parameter missing/unreadable -> handled 500, never a thrown 502', async () => {
    ssmMock
      .on(GetParameterCommand)
      .rejects(Object.assign(new Error('missing'), { name: 'ParameterNotFound' }));
    const res = await tokenHandler(event({ username: 'admin', password: 'correct-horse' }));
    expect(res.statusCode).toBe(500);
    expect(parse<ErrorResponse>(res).error.code).toBe('INTERNAL_ERROR');
    expect(apigwMock.commandCalls(GetApiKeysCommand)).toHaveLength(0);
  });

  it('bad password -> 401 and the API key is never looked up', async () => {
    const res = await tokenHandler(event({ username: 'admin', password: 'wrong' }));
    expect(res.statusCode).toBe(401);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_CREDENTIALS');
    expect(apigwMock.commandCalls(GetApiKeysCommand)).toHaveLength(0);
  });

  it('bad username -> 401 (same error as bad password — no user enumeration)', async () => {
    const res = await tokenHandler(event({ username: 'root', password: 'correct-horse' }));
    expect(res.statusCode).toBe(401);
    expect(parse<ErrorResponse>(res).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('good credentials -> API key returned, looked up BY NAME with values included', async () => {
    const res = await tokenHandler(event({ username: 'admin', password: 'correct-horse' }));
    expect(res.statusCode).toBe(200);
    expect(parse<TokenResponse>(res).api_key).toBe('da2-secret-key-value');
    const lookup = apigwMock.commandCalls(GetApiKeysCommand)[0].args[0].input;
    expect(lookup.nameQuery).toBe('dev-ghana-admin-key');
    expect(lookup.includeValues).toBe(true);
  });

  it('good credentials but key not found -> 500 KEY_LOOKUP_FAILED (no key leak in error)', async () => {
    apigwMock.on(GetApiKeysCommand).resolves({ items: [] });
    const res = await tokenHandler(event({ username: 'admin', password: 'correct-horse' }));
    expect(res.statusCode).toBe(500);
    expect(parse<ErrorResponse>(res).error.code).toBe('KEY_LOOKUP_FAILED');
  });

  it('400s missing fields', async () => {
    const res = await tokenHandler(event({ username: 'admin' }));
    expect(res.statusCode).toBe(400);
  });
});
