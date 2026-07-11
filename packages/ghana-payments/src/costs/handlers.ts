import type { APIGatewayProxyResult } from 'aws-lambda';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { handleError, ok } from '../shared/http.js';

const ce = new CostExplorerClient({ region: 'us-east-1' }); // CE is a global/us-east-1 API
const ssm = new SSMClient({});
const CACHE_TTL_MS = 6 * 3600_000; // each CE query costs $0.01 — cache hard

interface CostSnapshot {
  fetched_at: string;
  month_to_date_usd: number;
  yesterday_usd: number;
  month: string;
  note: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchFromCostExplorer(): Promise<CostSnapshot> {
  const now = new Date();
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const tomorrow = iso(new Date(now.getTime() + 86400_000));
  const yesterday = iso(new Date(now.getTime() - 86400_000));

  const mtd = await ce.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: monthStart, End: tomorrow },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
    })
  );
  const daily = await ce.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: yesterday, End: tomorrow },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
    })
  );

  const sum = (results?: { Total?: Record<string, { Amount?: string }> }[]): number =>
    (results ?? []).reduce((acc, r) => acc + parseFloat(r.Total?.UnblendedCost?.Amount ?? '0'), 0);

  return {
    fetched_at: now.toISOString(),
    month_to_date_usd: Math.round(sum(mtd.ResultsByTime) * 100) / 100,
    yesterday_usd: Math.round(parseFloat(daily.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount ?? '0') * 100) / 100,
    month: now.toISOString().slice(0, 7),
    note: 'Whole AWS account, unblended. Cost Explorer data lags ~24h.',
  };
}

/**
 * GET /v1/costs (admin) — account month-to-date + yesterday's cost for the portal
 * footer. Cached in SSM for 6h because every Cost Explorer call bills $0.01.
 */
export const handler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const paramName = process.env.COST_CACHE_PARAM as string;
    try {
      const cached = await ssm.send(new GetParameterCommand({ Name: paramName }));
      const snapshot = JSON.parse(cached.Parameter?.Value ?? '{}') as CostSnapshot;
      if (snapshot.fetched_at && Date.now() - Date.parse(snapshot.fetched_at) < CACHE_TTL_MS) {
        return ok({ ...snapshot, cached: true });
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'ParameterNotFound') throw err;
    }

    const snapshot = await fetchFromCostExplorer();
    await ssm.send(
      new PutParameterCommand({
        Name: paramName,
        Value: JSON.stringify(snapshot),
        Type: 'String',
        Overwrite: true,
      })
    );
    return ok({ ...snapshot, cached: false });
  } catch (err) {
    return handleError(err);
  }
};
