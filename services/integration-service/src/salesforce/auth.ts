import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface SalesforceAuth {
  accessToken: string;
  instanceUrl: string;
}

/**
 * Authenticates to Salesforce via the OAuth 2.0 JWT Bearer Flow: signs a
 * JWT with the Connected/External Client App's private key, asserting the
 * configured username, and exchanges it for an access token.
 *
 * See docs/decisions/0002-authentication-strategy.md.
 */
export async function authenticate(): Promise<SalesforceAuth> {
  const privateKey = readFileSync(config.salesforce.jwtPrivateKeyPath, 'utf8');

  const assertion = jwt.sign(
    {
      iss: config.salesforce.clientId,
      sub: config.salesforce.username,
      aud: config.salesforce.jwtAudience,
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '3m' }
  );

  const response = await fetch(`${config.salesforce.loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      `Salesforce JWT bearer auth failed (${response.status}): ${JSON.stringify(body)}`
    );
  }

  return {
    accessToken: body.access_token as string,
    instanceUrl: body.instance_url as string,
  };
}
