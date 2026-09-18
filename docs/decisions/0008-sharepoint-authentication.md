# 0008. SharePoint authentication: Microsoft Graph OAuth 2.0 Client Credentials with `Sites.Selected`

## Context

`services/document-workspace-service` (Developer #2's Phase 5 exercise —
Salesforce → SharePoint) needs to authenticate to Microsoft Graph
non-interactively to create one document-library folder per distributor
in the `Distributor Workspaces` SharePoint site. As with ServiceNow
(ADR 0004), there is no human present at request time, so an
interactive/delegated sign-in flow is not viable for the running
service.

Microsoft Graph's application (app-only) permission model offers two
relevant options for SharePoint access:

- `Sites.ReadWrite.All` — read/write access to every site in the
  tenant.
- `Sites.Selected` — no access to any site by default; access to
  specific sites is granted individually via a one-time
  `POST /sites/{id}/permissions` call.

## Decision

Use the OAuth 2.0 **Client Credentials** grant against Microsoft Entra
ID (the same grant type as ADR 0004's ServiceNow decision, for the same
reason: a background service, no signed-in user), with the Graph
**application** permission **`Sites.Selected`**, scoped to exactly one
site: `Distributor Workspaces`.

Concretely:

- A dedicated single-tenant Azure AD app registration,
  `Golden Vine Document Workspace Service`, was created — not a shared
  or administrative identity.
- The app's only Graph application permission is `Sites.Selected`
  (admin-consented). It has no default access to any SharePoint site,
  including the tenant's own root site.
- Write access to the one site this integration needs was granted
  separately, via `POST /sites/{site-id}/permissions` with
  `"roles": ["write"]` and the app's id/displayName under
  `grantedToIdentities` — see
  `docs/runbooks/sharepoint-non-interactive-auth-setup.md` for the exact
  steps and `docs/devex/observations.md` OB-0032 for the confirmed
  `201 Created` evidence.
- The service authenticates using `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/
  `AZURE_CLIENT_SECRET` against
  `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`,
  requesting scope `https://graph.microsoft.com/.default` — see
  `.env.example`.

## Alternatives considered

- **`Sites.ReadWrite.All`:** rejected as the direct analog of ADR
  0004's rejected "admin as the OAuth application user" — it would
  give this integration's token write access to every SharePoint site
  in the tenant, including ones with no relationship to distributor
  onboarding, for no benefit over the one site it actually needs.
- **Delegated (signed-in user) auth:** rejected for the same reason
  ADR 0004 rejected ServiceNow's Authorization Code grant — no human is
  present when a real Salesforce event triggers this service.
- **Certificate-based app-only auth (legacy SharePoint "Site collection
  App permissions" / `appinv.aspx` model):** not viable here — that
  model predates Sites.Selected and is not how a modern Entra ID app
  registration is granted SharePoint access; `Sites.Selected` is the
  currently supported least-privilege mechanism.

## Consequences

- Access control is enforced by the explicit per-site grant, not by
  Graph application-permission scope alone — structurally similar to
  ADR 0004's finding that ServiceNow's `useraccount` OAuth scope did
  no real access-control work and the dedicated `itil` role did.
  Here, `Sites.Selected` plus the site-level grant *does* do real,
  fine-grained work: this app cannot read or write any SharePoint site
  other than the one explicitly granted.
- The one-time site-level grant itself required a materially broader,
  delegated `Sites.FullControl.All` permission, held briefly by a human
  admin — a real asymmetry against Salesforce's and ServiceNow's setup
  flows, which needed no equivalent broad, temporary grant to create a
  narrowly-scoped credential. See `docs/devex/friction-log.md` FL-0033
  for the full account of why, and OB-0032 for confirmation this
  bootstrap step is not required again for routine operation — only for
  granting a new site or a new app.
- The client secret is a plain shared secret (same category of
  credential as ServiceNow's, unlike Salesforce's signed-JWT
  private key) — stored the same way: in `.env`, gitignored, never
  committed.
- This decision was made from direct, hands-on setup experience (this
  session), not written speculatively in advance — consistent with this
  project's Developer #1/Developer #2 practice of letting ADRs follow
  real platform experience rather than precede it.
