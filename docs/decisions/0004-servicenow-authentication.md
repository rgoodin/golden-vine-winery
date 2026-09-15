# 0004. ServiceNow authentication: OAuth 2.0 Client Credentials Grant

## Context

The integration service needs to authenticate to ServiceNow non-interactively
to create Incidents via the Table API. Unlike Salesforce, ServiceNow's
Machine Identity Console (the current inbound-integration setup UI - see
`docs/devex/friction-log.md` FL-0007) offers several inbound grant types:
Authorization Code, Client Credentials, JWT Bearer, and Resource Owner
Password Credentials.

## Decision

Use the OAuth 2.0 **Client Credentials** grant: the integration service
authenticates with a client ID/secret pair directly against
`<instance>/oauth_token.do`, no per-request signing or user interaction
required.

Concretely:

- A dedicated ServiceNow user, `golden.vine.integration` ("Golden Vine
  Integration"), was created with the **`itil`** role only - not admin -
  and marked as an Internal Integration User.
- An Inbound Integration ("Golden Vine Integration Service") was created
  with the Client Credentials grant, using that user as the "OAuth
  application user" (the identity the token acts as), Auth scope
  `useraccount` (the only scope available in this instance - see FL-0010).
- The service authenticates using `SERVICENOW_CLIENT_ID` and
  `SERVICENOW_CLIENT_SECRET` - see `.env.example`.
- Required enabling the system property
  `glide.oauth.inbound.client.credential.grant_type.enabled` (not set by
  default) - see FL-0008.

## Alternatives considered

- **JWT Bearer grant:** more consistent with the Salesforce side (ADR
  0002), but adds signing/certificate complexity with no clear benefit for
  a personal dev instance; Client Credentials is the more standard choice
  for pure machine-to-machine ServiceNow integrations.
- **Resource Owner Password Credentials:** explicitly discouraged by
  ServiceNow's own UI ("It is recommended to use Authorization code grant
  instead"), and requires storing a user password rather than a
  client secret.
- **Authorization Code grant:** requires interactive user consent - not
  viable for a service with no human present.
- **Admin as the OAuth application user:** rejected - would give the
  integration's token full org-admin rights. A dedicated `itil`-role user
  is the actual access-control boundary here, since Auth Scope alone
  couldn't provide it (FL-0010).

## Consequences

- Access control is enforced by the dedicated user's `itil` role and
  ServiceNow's ACLs, not by the OAuth Auth Scope - because selecting the
  only available scope (`useraccount`) disables the "Limit authorization
  to the following APIs" restriction entirely (FL-0010). A more precise,
  API-level scope would require creating a custom Auth Scope, deferred as
  unnecessary complexity for this first test.
- The client secret is a plain shared secret (unlike Salesforce's
  private-key-signed JWT) - store it the same way as
  `SALESFORCE_CLIENT_ID`/credentials: in `.env`, gitignored, never
  committed.
- This decision was made before hands-on experience with ServiceNow's
  Machine Identity Console. Per `CLAUDE.md`'s Developer #1 principle,
  revisit if a second ServiceNow-consuming integration surfaces friction
  with this approach.
