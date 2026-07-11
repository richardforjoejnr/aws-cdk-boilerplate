import type { APIGatewayProxyResult } from 'aws-lambda';

/** API error model per concept.md Appendix A. CORS handled by API Gateway, never here. */
export function ok(body: unknown, statusCode = 200): APIGatewayProxyResult {
  return { statusCode, body: JSON.stringify(body) };
}

export function apiError(
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }),
  };
}

export function parseBody<T>(body: string | null): T {
  if (!body) throw new BadRequestError('MISSING_BODY', 'Request body is required');
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new BadRequestError('INVALID_JSON', 'Request body must be valid JSON');
  }
}

export class BadRequestError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/** Valid positive integer pesewas amount (money is never a float — package CLAUDE.md). */
export function requirePesewas(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestError(
      'INVALID_AMOUNT',
      `${field} must be a positive integer amount in pesewas`
    );
  }
  return value;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError('INVALID_FIELD', `${field} is required`);
  }
  return value.trim();
}

export function handleError(err: unknown): APIGatewayProxyResult {
  if (err instanceof BadRequestError) return apiError(400, err.code, err.message);
  console.error('Unhandled error', err);
  return apiError(500, 'INTERNAL_ERROR', 'Internal server error');
}
