import { config } from '../config';

export interface ServiceNowAuth {
  accessToken: string;
}

/**
 * Authenticates to ServiceNow via the OAuth 2.0 Client Credentials grant.
 * See docs/decisions/0004-servicenow-authentication.md.
 */
export async function authenticate(): Promise<ServiceNowAuth> {
  const response = await fetch(`${config.serviceNow.instanceUrl}/oauth_token.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.serviceNow.clientId,
      client_secret: config.serviceNow.clientSecret,
    }),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`ServiceNow OAuth token request failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return { accessToken: body.access_token as string };
}
