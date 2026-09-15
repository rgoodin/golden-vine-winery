# Runbook: Salesforce non-interactive auth setup

For a service (no human present) to authenticate to Salesforce via the
JWT Bearer Flow. Written from what actually happened setting this up for
`services/integration-service` — see
`docs/decisions/0002-authentication-strategy.md` and
`docs/devex/friction-log.md` (FL-0002, FL-0003) for the full detail and
reasoning behind each step.

This is a checklist, not automation — several steps (email verification,
reviewing what you're granting) are deliberately manual and shouldn't be
scripted away.

## Before you start

- [ ] You have (or have created) a Salesforce org to connect to.
- [ ] You've generated a self-signed cert/key pair locally, e.g.:

  ```
  openssl req -x509 -sha256 -nodes -days 3650 -newkey rsa:2048 \
    -keyout server.key -out server.crt \
    -subj "/CN=<service-name>/O=<org/project name>"
  ```

  Keep `server.key` out of version control. Only the `.crt` gets uploaded
  to Salesforce.

## Steps

1. **Don't look for "New Connected App."** Current Salesforce orgs use
   **External Client Apps** instead (Setup → App Manager → **New External
   Client App**). The classic Connected App flow may still exist in some
   orgs, but don't build against tutorials/screenshots that reference it —
   verify against what's actually in front of you (see
   `docs/devex/lessons-learned.md` LL-0001).

2. Fill in **Basic Information** (name, API name, contact email).

3. Expand **API (Enable OAuth Settings)**, check **Enable OAuth**:
   - Callback URL: required by the form even though JWT bearer flow
     doesn't use it — any valid URL works, e.g.
     `https://login.salesforce.com/services/oauth2/callback`.
   - OAuth Scopes: add at minimum `Manage user data via APIs (api)` and
     `Perform requests at any time (refresh_token, offline_access)`.
   - Scroll to **Flow Enablement**, check **Enable JWT Bearer Flow** — this
     is what reveals the certificate upload field (not a separate "Use
     digital signatures" checkbox from older docs). Upload your `.crt`.

4. Save. Changes can take up to ~10 minutes to propagate.

5. **Retrieving the Consumer Key requires an email verification step** —
   this is expected, not a bug. Go to the app's **Settings** tab → OAuth
   Settings → **Consumer Key and Secret**, and complete the emailed
   one-time code when prompted.

6. **Pre-authorize the app for non-interactive use.** By default, Permitted
   Users is "All users can self-authorize," which implies interactive
   consent — not viable for a headless service. Go to the app's
   **Policies** tab → OAuth Policies → **Edit**, and change Permitted
   Users to **"Admin approved users are pre-authorized."** Saving reveals
   a **Select Profiles** picker *inline on the same form* — this is easy
   to miss, since older docs describe a separate "Manage" step that
   doesn't exist in the current UI. Add the profile(s) that should be
   allowed to use this integration.

## Result

You should have: a Consumer Key (Client ID), the org's My Domain URL, the
username to authenticate as, and a local private key. See
`services/integration-service/.env.example` for how these map to config,
and `docs/decisions/0002-authentication-strategy.md` for the JWT `aud`
claim gotcha (FL-0005) if you're implementing the token exchange from
scratch.
