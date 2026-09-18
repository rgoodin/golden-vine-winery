# 0010. Infrastructure as Code: no tooling adopted yet, and the distinction this project actually has

## Context

`CLAUDE.md`'s Infrastructure as Code section says to "prefer
Infrastructure as Code wherever infrastructure is under our control,"
names Terraform as the preferred technology, and asks to "document the
distinction between: infrastructure, application configuration, and
integration configuration." That distinction was never written down -
scoping actual IaC work surfaced the need to answer it with real
evidence from this project, not by assumption.

## Decision

**No IaC tooling (Terraform or otherwise) is adopted at this time.**
Applying the three-way distinction `CLAUDE.md` asks for, using this
project's real components:

- **Infrastructure** (compute/storage/networking under our control):
  effectively none. The one candidate is the local hourly crontab entry
  for `services/integration-service`'s scheduled audit
  (`docs/devex/observations.md` OB-0031) - single-host, single-line,
  already version-controlled as a reference file
  (`scripts/ops/crontab-hourly-audit.txt`) plus an idempotent wrapper
  script. Introducing Terraform (or even Ansible) for one crontab line
  on one developer machine would be real tooling weight for no
  demonstrated benefit - it is already "as code" in every way that
  matters here.
- **Application configuration**: environment variables (`.env`, one per
  service, `dotenv`), local SQLite state and checkpoint files. Standard
  12-factor config, already owned by each service's own `.env.example`
  and README - not an infrastructure concern, and no IaC tool is the
  right shape for "a Node process reads its own environment."
- **Integration configuration**: the real candidates - Salesforce's
  External Client App/JWT Bearer Flow/Platform Event schema
  (`docs/decisions/0002-authentication-strategy.md`,
  `docs/runbooks/salesforce-non-interactive-auth-setup.md`);
  ServiceNow's Machine Identity Console/dedicated `itil`-role
  user/Client Credentials grant
  (`docs/decisions/0004-servicenow-authentication.md`,
  `docs/runbooks/servicenow-non-interactive-auth-setup.md`); Azure AD's
  app registration/`Sites.Selected` permission/SharePoint site
  (`docs/decisions/0008-sharepoint-authentication.md`,
  `docs/runbooks/sharepoint-non-interactive-auth-setup.md`). All three
  live inside third-party SaaS platforms, and all three independently
  reached the same conclusion - deliberately manual, checklist-driven,
  not automated - at the time each was set up. `docs/devex/friction-log.md`
  FL-0033, from this same session, reaffirmed that specifically for the
  Azure AD app registration's one-time `Sites.FullControl.All`
  bootstrap step: "a well-written checklist is enough... keep the idea
  of a reusable/scripted procedure as a follow-up... revisit after more
  iterations." This ADR does not reverse that call - no new evidence
  has appeared since it was made a few rounds ago in the same session.

This is now the **fourth** independent instance (Salesforce, ServiceNow,
SharePoint auth, SharePoint's specific bootstrap step) where "keep this
manual" was the evidence-backed conclusion for integration
configuration, echoing Finding 5 of the Phase 2 review: "Additional
implementations should provide evidence (repeated real friction, not a
hypothetical) before self-service capability is built here." Four
platforms landing on the same answer independently is itself real
signal, worth naming plainly rather than treating each instance as an
isolated call.

## Alternatives considered

- **Terraform the Azure AD app registration** (the one candidate with a
  mature, official provider - `azurerm`/`azuread`). Rejected for now -
  directly reverses FL-0033's explicit "revisit after more iterations"
  call, made deliberately in this same session, with no new evidence to
  justify reversing it already.
- **Terraform or Ansible the crontab installation.** Rejected - single
  host, single line, already checked in as a reference file; the
  installation itself was a deliberate, reviewed action (OB-0031), not
  a source of repeated pain.
- **Adopt IaC broadly now because it is a named project goal.**
  Rejected - this project's own recurring discipline (CI/CD Philosophy's
  "do not implement stages that provide no demonstrated value," Finding
  5, Engineering Behavior's "make the smallest useful change," and this
  session's own lint/CI-CD scoping decisions) argues against building
  capability ahead of evidenced need. Naming IaC as a goal in `CLAUDE.md`
  does not itself constitute the evidence Finding 5 asks for.

## Consequences

- No Terraform/Ansible/CloudFormation dependency is introduced into this
  repository.
- `CLAUDE.md`'s Infrastructure as Code section's outstanding
  "document the distinction" instruction is fulfilled by this ADR -
  that section's own text is left otherwise unmodified.
- **The concrete trigger for revisiting**, matching Finding 5's bar
  exactly: repeated real friction from manually repeating the *same*
  platform setup multiple times (e.g., a genuine second ServiceNow
  instance, a third SharePoint site) - a hypothetical future need is
  not sufficient on its own.
- If that evidence ever appears, the Azure AD app registration (mature
  official Terraform provider, and the platform where FL-0033 already
  flagged a scripting candidate) is the most likely first real IaC
  target - not decided here, just the most plausible next candidate if
  and when the trigger fires.
