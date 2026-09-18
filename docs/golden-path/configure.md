# Configure

## Install

From the repository root (not from inside `services/integration-service/`
- this is now an npm workspace):

```
npm install
```

This resolves `golden-path-reliability` and `golden-path-salesforce-transport`
as local packages (symlinked, not fetched from any registry) alongside
every service's own dependencies.

## Credentials

Two runbooks, written from what actually happened setting these up, not
idealized steps:

- [`docs/runbooks/salesforce-non-interactive-auth-setup.md`](../runbooks/salesforce-non-interactive-auth-setup.md) -
  Salesforce JWT Bearer Flow (External Client App, certificate, pre-authorization).
- [`docs/runbooks/servicenow-non-interactive-auth-setup.md`](../runbooks/servicenow-non-interactive-auth-setup.md) -
  ServiceNow OAuth Client Credentials (dedicated integration user, the
  narrowest role that covers what you need).

**Neither is self-service, and that's deliberate** (Phase 2 Observation
Review Finding 5). Machine identity, OAuth configuration, and target-side
roles/ACLs stay Platform/target-team owned until real, repeated evidence
justifies automating a human review step out of a platform-wide
security configuration change - not because automation is hard, but
because nothing has shown yet that removing that review is safe. See
`docs/golden-path/ownership-boundaries.md`.

Both runbooks are explicit that some steps (email verification,
reviewing what you're granting) are irreducibly manual - see Finding 2.
Don't script around them.

Once you have credentials, copy `services/integration-service/.env.example`
to `.env` in your own integration's directory and fill in the values -
never commit the real file.

Next: `docs/golden-path/run.md`.
