import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';

/**
 * Everything `authenticate()` and the rest of this package need to
 * connect to a specific Salesforce org. Deliberately a plain parameter,
 * not a module-level singleton read from environment variables directly
 * - a reusable package can't assume it's the only Salesforce connection
 * a process will ever need, or that env vars are even how the consuming
 * service manages its configuration. The consuming service owns reading
 * its own environment and constructing this object - see
 * golden-vine-winery's `services/integration-service/src/config.ts`
 * (`config.salesforce`) for the shape this was extracted from.
 */
export interface SalesforceTransportConfig {
  loginUrl: string;
  clientId: string;
  username: string;
  jwtPrivateKeyPath: string;
  jwtAudience: string;
  pubsubHost: string;
}

export interface SalesforceAuth {
  accessToken: string;
  instanceUrl: string;
}

/**
 * Authenticates to Salesforce via the OAuth 2.0 JWT Bearer Flow: signs a
 * JWT with the Connected/External Client App's private key, asserting the
 * configured username, and exchanges it for an access token.
 *
 * See docs/decisions/0002-authentication-strategy.md in the
 * golden-vine-winery repository this package was extracted from.
 */
export async function authenticate(config: SalesforceTransportConfig): Promise<SalesforceAuth> {
  const privateKey = readFileSync(config.jwtPrivateKeyPath, 'utf8');

  const assertion = jwt.sign(
    {
      iss: config.clientId,
      sub: config.username,
      aud: config.jwtAudience,
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '3m' }
  );

  const response = await fetch(`${config.loginUrl}/services/oauth2/token`, {
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
