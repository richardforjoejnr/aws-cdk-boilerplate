import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { apiError, handleError, ok, parseBody, requireString } from '../shared/http.js';

const ssm = new SSMClient({});
const VALID_SOURCES = ['admin', 'soundbox', 'pay'];

let cachedToken: string | null = null;
async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await ssm.send(
    new GetParameterCommand({ Name: process.env.GITHUB_TOKEN_PARAM, WithDecryption: true })
  );
  cachedToken = res.Parameter?.Value ?? '';
  return cachedToken;
}

/**
 * POST /v1/issues — create a GitHub issue from the portals (title + description).
 * The GitHub token lives in SSM SecureString (set out-of-band, never in the repo);
 * the browser never sees it. Public endpoint by design (soundbox has no auth) —
 * PoC guards are input limits + API throttling; issues are labelled by source.
 */
export const createHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = parseBody<{ title: string; description: string; source?: string }>(event.body);
    const title = requireString(body.title, 'title');
    const description = requireString(body.description, 'description');
    if (title.length > 200) return apiError(400, 'TITLE_TOO_LONG', 'title must be ≤ 200 chars');
    if (description.length > 5000) {
      return apiError(400, 'DESCRIPTION_TOO_LONG', 'description must be ≤ 5000 chars');
    }
    const source = VALID_SOURCES.includes(body.source ?? '') ? (body.source as string) : 'portal';

    const token = await getToken();
    if (!token) {
      return apiError(503, 'ISSUES_NOT_CONFIGURED', 'GitHub token is not configured');
    }

    const res = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPO}/issues`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'ghana-payments-poc',
        },
        body: JSON.stringify({
          title,
          body:
            `${description}\n\n---\n` +
            `_Reported from the **${source}** page of the Ghana Payments PoC ` +
            `(stage: ${process.env.STAGE}) at ${new Date().toISOString()}_`,
          labels: ['from-portal', `source:${source}`],
        }),
      }
    );
    if (!res.ok) {
      console.error('GitHub issue creation failed', res.status, await res.text());
      return apiError(502, 'GITHUB_ERROR', `GitHub rejected the issue (HTTP ${res.status})`);
    }
    const issue = (await res.json()) as { html_url: string; number: number };
    return ok({ issue_url: issue.html_url, number: issue.number }, 201);
  } catch (err) {
    return handleError(err);
  }
};
