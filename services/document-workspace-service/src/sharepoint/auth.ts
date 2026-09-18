import { config } from '../config';

export interface SharePointAuth {
  accessToken: string;
}

/**
 * Authenticates to Microsoft Graph via the OAuth 2.0 Client Credentials
 * grant, scoped to this app registration's Sites.Selected permission.
 * See docs/decisions/0008-sharepoint-authentication.md.
 */
export async function authenticate(): Promise<SharePointAuth> {
  const response = await fetch(
    `https://login.microsoftonline.com/${config.sharepoint.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.sharepoint.clientId,
        client_secret: config.sharepoint.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  );

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`Microsoft Graph OAuth token request failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return { accessToken: body.access_token as string };
}
