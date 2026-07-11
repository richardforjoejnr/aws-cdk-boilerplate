import type { SQSEvent } from 'aws-lambda';

/**
 * Consumes the mock provider's delayed callback queue and POSTs each callback over
 * HTTPS to the real public webhook endpoint (design-review F-2) — the mock exercises
 * API Gateway and the receiver exactly as MTN would. Throws on non-2xx so SQS
 * retries and eventually DLQs.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  const url = process.env.WEBHOOK_URL as string;
  for (const record of event.Records) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: record.body,
    });
    if (!res.ok) {
      throw new Error(`Webhook delivery failed: HTTP ${res.status} ${await res.text()}`);
    }
  }
};
