# Observations

This is the raw developer experience log for the Salesforce → ServiceNow
integration (and later integrations). It captures what happened while
building the integration — not just friction, but anything worth remembering:
decisions in the moment, surprises, dead ends, things that worked well.

Per `CLAUDE.md`:

- We are intentionally beginning as Developer #1.
- The Golden Path must emerge from observed developer friction, not upfront
  design.
- Not every observation is friction — capture things that went smoothly too,
  so Phase 2 (Observation Review) has a complete picture.

See also `docs/devex/friction-log.md` (for friction specifically),
`docs/devex/decisions.md`, and `docs/devex/lessons-learned.md`.

## How to use this log

1. Capture observations as they happen, in roughly chronological order.
2. Keep entries short — this is a log, not a report. Expand into
   `friction-log.md` or an ADR in `docs/decisions/` if an entry turns out to
   be significant.
3. During Phase 2, classify entries into categories such as: environment
   setup, authentication, secrets, API discovery, schemas, testing, error
   handling, deployment, observability, documentation.

---

## Template

### OB-XXXX: <short title>

**Date:** YYYY-MM-DD
**Phase:** <current DevEx Dojo phase>
**Category:** <e.g. environment setup, authentication, API discovery, testing>

What happened? What was being attempted, and what was noticed?

---

### OB-0001: Scaffolded integration-service, deferred Pub/Sub implementation

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** environment setup / API discovery

Scaffolded `services/integration-service` (Node.js + TypeScript) with a
config loader, the canonical `DistributorOnboardingRequested` event type,
and a stub Salesforce Pub/Sub subscriber. Deliberately stopped short of
implementing real Salesforce authentication/subscription — see FL-0001 —
rather than guessing at an approach.

---

### OB-0002: Signed up for Developer Edition org, created External Client App

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** environment setup / authentication

Signed up for a Salesforce Developer Edition org (developer did this
directly — account creation and email verification aren't something an
agent should do on a developer's behalf). Generated a local self-signed
cert/key pair, created an External Client App with the JWT Bearer Flow
enabled and the cert uploaded, and retrieved the Consumer Key (after an
email identity-verification step). Wired these into
`services/integration-service/.env` (gitignored). See
`docs/decisions/0002-authentication-strategy.md` and FL-0002/FL-0003 for
what was learned along the way.

Still open: the integration service's Pub/Sub subscriber
(`src/salesforce/subscriber.ts`) remains a stub — having credentials
doesn't yet mean there's a gRPC/Avro client that uses them (FL-0001).

---

### OB-0003: Pre-authorized the External Client App for non-interactive JWT auth

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** authentication

The External Client App defaulted to Permitted Users =
"All users can self-authorize," which implies an interactive consent step —
not viable for a service with no human present. Changed it to "Admin
approved users are pre-authorized" and added the System Administrator
profile under Selected Profiles (Policies tab → OAuth Policies → Edit).
This was easy to miss: the profile picker only appears inline on the same
edit form once "Admin approved" is selected, not as a separate "Manage"
step, which wasn't obvious from the UI.

This closes out the Salesforce-side auth setup blocking FL-0001. What
remains for FL-0001 is purely code: the actual gRPC/Avro Pub/Sub client
implementation in `src/salesforce/subscriber.ts`.

---

### OB-0004: First end-to-end event proven — Phase 1's actual milestone

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** testing / milestone

Implemented the real Pub/Sub client (`src/salesforce/auth.ts`,
`pubsubClient.ts`, using Salesforce's official `pubsub_api.proto` -
`docs/decisions/0002-authentication-strategy.md`), created the
`Distributor_Onboarding_Requested__e` Platform Event with one field, wrote
a small test-event publisher (`scripts/publish-test-event.ts`), and ran the
whole thing against the real dev org:

    npm run dev                                  # subscriber connects, waits
    npm run publish-test-event -- "Acme Distribution Co"   # publishes via REST

The subscriber logged the received event in real time, with the real
`Distributor_Name__c` value, `CreatedDate`, `CreatedById`, and `replayId`.

Two small mismatches were caught and fixed along the way: the JWT `aud`
claim (FL-0005) and the Platform Event's actual (underscored) API name
vs. the assumed PascalCase name (FL-0006).

This is `CLAUDE.md`'s stated first milestone for the "Developer #1"
experiment (minus the ServiceNow leg, which doesn't exist yet): a
realistic Salesforce event reaching the integration layer, with the
experience documented along the way.

---

<!-- Add new entries above this line, most recent first. -->
