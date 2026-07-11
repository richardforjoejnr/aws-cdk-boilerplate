import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

export interface MockConfig {
  failAmountPesewas: number;
  timeoutAmountPesewas: number;
  duplicateAmountPesewas: number;
  callbackDelaySeconds: number;
  sweeperExpiryMinutes: number;
  activeProvider: string;
}

let cached: MockConfig | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

/** Reads /{stage}/ghana-payments/* SSM params (magic amounts etc. — ADR-7). Cached 60s per container. */
export async function getConfig(): Promise<MockConfig> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  const stage = process.env.STAGE ?? 'dev';
  const res = await ssm.send(
    new GetParametersByPathCommand({ Path: `/${stage}/ghana-payments/`, Recursive: true })
  );
  const get = (suffix: string, fallback: string): string =>
    res.Parameters?.find((p) => p.Name?.endsWith(suffix))?.Value ?? fallback;
  cached = {
    failAmountPesewas: Number(get('mock/fail-amount-pesewas', '1300')),
    timeoutAmountPesewas: Number(get('mock/timeout-amount-pesewas', '999')),
    duplicateAmountPesewas: Number(get('mock/duplicate-amount-pesewas', '222')),
    callbackDelaySeconds: Number(get('mock/callback-delay-seconds', '3')),
    sweeperExpiryMinutes: Number(get('sweeper/expiry-minutes', '5')),
    activeProvider: get('provider/active', 'mock'),
  };
  cachedAt = Date.now();
  return cached;
}

/** Test seam. */
export function _resetConfigCache(): void {
  cached = null;
}
