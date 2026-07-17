import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { APIGatewayClient, GetApiKeysCommand } from '@aws-sdk/client-api-gateway';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { timingSafeEqual } from 'node:crypto';
import { apiError, handleError, ok, parseBody, requireString } from '../shared/http.js';
import { hashPii } from '../shared/pii.js';

const ssm = new SSMClient({});
const apigw = new APIGatewayClient({});

interface StoredCredentials {
  username: string;
  password_hash: string; // hashPii(password) — plaintext never stored
}

let cachedCreds: StoredCredentials | null = null;

async function getCredentials(): Promise<StoredCredentials> {
  if (cachedCreds) return cachedCreds;
  const res = await ssm.send(
    new GetParameterCommand({ Name: process.env.ADMIN_CREDS_PARAM, WithDecryption: true })
  );
  cachedCreds = JSON.parse(res.Parameter?.Value ?? '{}') as StoredCredentials;
  return cachedCreds;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * POST /v1/auth/token — exchange the admin username/password for the admin API key,
 * so the merchant portal needs no AWS CLI. Credentials live as a hash in an SSM
 * SecureString (set out-of-band, never in the repo). PoC-grade: production path is
 * Cognito + RBAC (architecture.md §6).
 */
export const tokenHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = parseBody<{ username: string; password: string }>(event.body);
    const username = requireString(body.username, 'username');
    const password = requireString(body.password, 'password');

    const creds = await getCredentials();
    const userOk = safeEqual(username, creds.username ?? '');
    const passOk = safeEqual(hashPii(password), creds.password_hash ?? '');
    if (!userOk || !passOk) {
      return apiError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect');
    }

    // Looked up by NAME at runtime — an env ref to the key id creates a CFN cycle
    // (key -> stage -> deployment -> this route's method -> this lambda).
    const keys = await apigw.send(
      new GetApiKeysCommand({ nameQuery: process.env.ADMIN_API_KEY_NAME, includeValues: true })
    );
    const value = keys.items?.[0]?.value;
    if (!value) {
      console.error('Admin API key not found by name', { name: process.env.ADMIN_API_KEY_NAME });
      return apiError(500, 'KEY_LOOKUP_FAILED', 'Could not retrieve API key');
    }
    return ok({ api_key: value });
  } catch (err) {
    return handleError(err);
  }
};
