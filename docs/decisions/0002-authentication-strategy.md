# 0002. Salesforce authentication: OAuth 2.0 JWT Bearer Flow

## Context

The integration service needs to authenticate to Salesforce non-interactively
(no user present to click through a login/consent screen) in order to
subscribe to the `DistributorOnboardingRequested` Platform Event via the
Pub/Sub API. Salesforce's OAuth flows include JWT Bearer, username-password,
and interactive flows (web server, device).

## Decision

Use the OAuth 2.0 **JWT Bearer Flow**: the integration service holds a
private key, signs a JWT asserting the Salesforce username, and exchanges it
for an access token. No client secret or interactive login is involved.

Concretely, in this org (a Developer Edition using Salesforce's newer
**External Client App** UI — see `docs/devex/friction-log.md` FL-0002):

- A self-signed cert/key pair is generated locally
  (`services/integration-service/certs/`, gitignored — see FL-0002/FL-0003
  and `.gitignore`).
- An External Client App ("Golden Vine Integration Service") was created
  with OAuth enabled, scopes `api` and `refresh_token, offline_access`, and
  "Enable JWT Bearer Flow" checked with the `.crt` uploaded.
- The service authenticates using: `SALESFORCE_CLIENT_ID` (Consumer Key),
  `SALESFORCE_USERNAME`, and the local private key
  (`SALESFORCE_JWT_PRIVATE_KEY_PATH`) — see `.env.example`.

## Alternatives considered

- **Username-password flow:** simpler conceptually, but requires storing a
  password + security token, which is a weaker secret to protect than a
  private key that never leaves the service.
- **Interactive OAuth (web server flow):** not viable — there's no human
  present to click through consent each time the service authenticates.

## Consequences

- The Connected-App-creation flow this org actually presents (External
  Client Apps) doesn't match older Salesforce tutorials/documentation that
  reference "Connected Apps" and a single "Use digital signatures"
  checkbox — see FL-0002. Future developers on this project should expect
  that gap.
- Retrieving the Consumer Key requires a one-time email verification code
  (FL-0003) — a manual step that can't be scripted.
- The private key (`certs/server.key`) is the actual secret here and must
  never be committed; only the public `.crt` is uploaded to Salesforce.
- This still doesn't implement the gRPC/Avro side of the Pub/Sub API client
  — that remains open per FL-0001.
