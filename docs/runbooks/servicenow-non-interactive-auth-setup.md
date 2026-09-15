# Runbook: ServiceNow non-interactive auth setup

For a service (no human present) to authenticate to ServiceNow via the
OAuth 2.0 Client Credentials grant. Written from what actually happened
setting this up for `services/integration-service` — see
`docs/decisions/0004-servicenow-authentication.md` and
`docs/devex/friction-log.md` (FL-0007, FL-0008, FL-0009, FL-0010) for the
full detail and reasoning behind each step.

This is a checklist, not automation — the system property change in step
2 is a platform-wide security switch and should be a deliberate,
reviewed action each time, not silently scripted.

## Steps

1. **Don't look for "System OAuth → Application Registry" as your starting
   point.** Current ServiceNow instances point you at the **Machine
   Identity Console** instead (the classic list page banners "Introducing
   New Inbound Integration Experience"). Go to **Inbound Integrations** →
   **New Integration** → **OAuth - Client credentials grant**. Same lesson
   as Salesforce's Connected App shift — verify against the live UI, not
   older docs (`docs/devex/lessons-learned.md` LL-0001).

2. **Check whether Client Credentials grants are enabled at all** before
   filling out the form. If you see a banner reading roughly "property
   'glide.oauth.inbound.client.credential.grant_type.enabled' must be
   defined and set to true," that property likely doesn't exist yet in
   this instance (not merely `false`). Create it: System Properties → New
   → Name `glide.oauth.inbound.client.credential.grant_type.enabled`,
   Type `true | false`, Value `true`. The integration-creation form does
   *not* enforce this itself — it'll let you save a broken configuration
   without it.

3. **Create a dedicated integration user rather than using admin.**
   Users → New:
   - Check **Internal Integration User**.
   - Assign the narrowest role that covers what this integration needs
     (e.g. `itil` for Incident creation) — not `admin`. This role is your
     *real* access-control boundary (see step 5).

4. Fill in the Client Credentials grant form:
   - Name / Provider name: descriptive.
   - **OAuth application user**: the dedicated user from step 3. The
     picker searches by **display name, not User ID** — searching the
     literal username may return "No results found" even though the user
     exists. Search by first/last name instead.
   - Auth scope: a fresh instance typically only offers `useraccount`.

5. **Know what `useraccount` actually does before relying on it.**
   Selecting it disables "Limit authorization to the following APIs"
   entirely (the UI will say so) — there is no API-level restriction with
   this scope. The token's real access boundary is the assigned user's
   role from step 3, not the OAuth scope. If you need tighter guarantees
   than "whatever that role allows," you'll need to use **Create auth
   scope** to define a custom, narrower scope — not covered by this
   runbook since it wasn't needed yet (see FL-0010).

6. Save, then open the record and reveal the **Client secret** (eye icon).

## Result

You should have: a Client ID, a Client Secret, and the instance's base
URL. Token endpoint is always `<instance>/oauth_token.do`. See
`services/integration-service/.env.example` and
`src/servicenow/auth.ts` for the token exchange implementation.
