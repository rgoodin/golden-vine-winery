# Runbook: SharePoint (Microsoft Graph) non-interactive auth setup

For a service (no human present) to authenticate to Microsoft Graph and
write to one specific SharePoint site via the OAuth 2.0 Client
Credentials grant with `Sites.Selected`. Written from what actually
happened setting this up for `services/document-workspace-service` —
see `docs/decisions/0008-sharepoint-authentication.md` and
`docs/devex/friction-log.md` (FL-0032, FL-0033) for the full detail and
reasoning behind each step.

This is a checklist, not automation — the delegated-permission step in
particular (step 6) is a deliberate, reviewed human action each time,
not something to script.

## Steps

1. **Verify Microsoft 365 Developer Program eligibility before assuming
   it's your path to a free sandbox tenant.** It no longer enrolls
   every developer for free — self-service access now requires an
   eligible Visual Studio Professional/Enterprise subscription, ISV
   Success/Microsoft AI Cloud Partner Program membership, or a Premier/
   Unified Support contract (FL-0032). If none apply, sign up for a
   genuine Microsoft 365 Business Basic trial instead
   (microsoft.com/microsoft-365/business, "Try for free") — this
   provisions a real tenant with SharePoint, but requires a credit card
   and converts to a paid yearly subscription after the trial period
   unless canceled. **Note the conversion date and set your own
   reminder** — nothing in this project will track it for you.

2. **Set up MFA on the new tenant's admin account** when prompted
   (`admin.cloud.microsoft` will require it on first sign-in). This is
   an account-security decision for the tenant owner to make directly,
   not something to skip by default.

3. **Create a dedicated SharePoint site for this integration, rather
   than reusing the tenant's default site.** SharePoint admin center
   (`Show all` → SharePoint) → Active sites → Create → Team site →
   "Standard team" template (no themed sample content). A dedicated
   site keeps the least-privilege grant in step 7 scoped to something
   deliberate.

4. **Get the site's Graph composite ID before you need it** — Graph
   addresses a site as `{hostname},{site-collection-id},{web-id}`, not
   the SharePoint REST API's own site GUID alone. From the site itself
   (not the admin center, which returned an unauthorized error when hit
   directly): `GET {site-url}/_api/site/id` and
   `GET {site-url}/_api/web/id`, each returning one GUID. Concatenate as
   `hostname,site-id,web-id`.

5. **Register a dedicated single-tenant Azure AD app** — Entra admin
   center (`entra.microsoft.com`) → App registrations → New
   registration. Single tenant, no redirect URI (this is a
   machine-to-machine service). Create a client secret under
   Certificates & secrets — record it immediately; it is shown once.

6. **Add the Graph application permission `Sites.Selected`, not
   `Sites.ReadWrite.All`.** API permissions → Add a permission →
   Microsoft Graph → Application permissions → search "Sites.Selected".
   Grant admin consent for the tenant. This alone grants the app access
   to *no* site yet — that's step 7.

7. **Know before you start that granting the site-level permission
   itself requires a broad, temporary delegated permission** — there is
   no narrower way to do it (FL-0033). In Microsoft Graph Explorer
   (`developer.microsoft.com/graph/graph-explorer`), signed in as a
   tenant admin:
   - Set the request to `POST
     https://graph.microsoft.com/v1.0/sites/{graph-site-id}/permissions`
     (the composite ID from step 4).
   - Request body:
     ```json
     {
       "roles": ["write"],
       "grantedToIdentities": [
         {
           "application": {
             "id": "<app's Application (client) ID>",
             "displayName": "<app's display name>"
           }
         }
       ]
     }
     ```
   - Under "Modify Permissions," consent to the delegated
     `Sites.FullControl.All` permission — this is the broadest
     SharePoint delegated scope available, held only for this one call.
     Consider whether to revoke it from Graph Explorer's consent
     afterward if it won't be needed again soon.
   - Run the query. A `201 Created` response confirms the grant; treat
     anything else as not granted, not as "probably fine."

8. **Graph Explorer's sign-in is a browser popup** — if driving this
   setup through browser automation, expect that step to require a
   human's direct click; it is not something automation tooling can
   complete on its own.

## Result

You should have: a Tenant (Directory) ID, an Application (client) ID, a
client secret, and the target site's Graph composite ID. Token endpoint
is always `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token`,
requesting scope `https://graph.microsoft.com/.default`. See
`services/document-workspace-service/.env.example` and
`src/sharepoint/auth.ts` for the token exchange implementation.
