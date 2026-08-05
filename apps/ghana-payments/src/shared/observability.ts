/**
 * Structured logging + CloudWatch metrics (Embedded Metric Format).
 *
 * - log(): one JSON line per event with correlation ids, so CloudWatch Logs
 *   Insights can trace any payment / merchant / device across every service.
 * - emitMetrics(): writes EMF so CloudWatch extracts custom metrics straight from
 *   the log line — no PutMetricData calls, no added latency, near-zero cost.
 *
 * Cost rule (docs/planning/OBSERVABILITY.md): metric DIMENSIONS must stay
 * low-cardinality (status, service, network_type, reason). Never put merchant_id
 * or device_id in a dimension — those are counted in DynamoDB rollups instead.
 * Put them in `properties` (searchable in Logs Insights, not billed as metrics).
 */
type Level = 'info' | 'warn' | 'error';

const SERVICE = (process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'ghana').replace(/^[a-z0-9-]*-ghana-/, '');
const STAGE = process.env.STAGE ?? 'dev';
const NAMESPACE = `GhanaPayments/${STAGE}`;

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, service: SERVICE, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export interface MetricDef {
  name: string;
  value: number;
  unit?: 'Count' | 'Milliseconds' | 'None';
}

/**
 * Emit CloudWatch metrics via EMF. Publishes the metric(s) both broken down by the
 * given low-cardinality `dimensions` AND as an un-dimensioned aggregate, so a
 * dashboard can show totals and per-status/per-network splits from one line.
 */
export function emitMetrics(
  metrics: MetricDef[],
  dimensions: Record<string, string> = {},
  properties: Record<string, unknown> = {}
): void {
  const dimKeys = Object.keys(dimensions);
  const dimensionSets = dimKeys.length ? [dimKeys, [] as string[]] : [[] as string[]];
  const payload: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        { Namespace: NAMESPACE, Dimensions: dimensionSets, Metrics: metrics.map((m) => ({ Name: m.name, Unit: m.unit ?? 'None' })) },
      ],
    },
    service: SERVICE,
    ...dimensions,
    ...properties,
  };
  for (const m of metrics) payload[m.name] = m.value;
  console.log(JSON.stringify(payload));
}

export const METRIC_NAMESPACE = NAMESPACE;
