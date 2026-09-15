# Integration Service

Receives `DistributorOnboardingRequested` events from Salesforce and
creates a ServiceNow Incident for each one. See the root
[`CLAUDE.md`](../../CLAUDE.md) for the full architecture and phase roadmap.

## Status: Phase 1's first milestone achieved — full chain proven end-to-end

Salesforce → integration-service → ServiceNow works, live:
`Distributor_Onboarding_Requested__e` (full canonical field set — see
`docs/decisions/0003-platform-event-schema.md`) is published, received via
a real Pub/Sub API gRPC subscription, mapped onto the canonical nested
`DistributorOnboardingRequestedEvent` shape (`src/types/events.ts`), and
used to create a real ServiceNow Incident
(`docs/decisions/0004-servicenow-authentication.md`). See
`docs/devex/observations.md` (OB-0001–OB-0008) and
`docs/devex/friction-log.md` (FL-0001–FL-0014).

Two known gaps were deliberately tested rather than assumed:

- **Duplicate delivery** (FL-0011): confirmed — no idempotency boundary
  exists anywhere, not fixed.
- **Crash recovery** (FL-0012): a minimal replay-checkpoint experiment
  (`src/salesforce/checkpoint.ts`) confirmed an event published while the
  service is offline **can** be recovered via `ReplayPreset.CUSTOM` — see
  `docs/devex/observations.md` OB-0008. This is a working experiment, not
  a production reliability feature: the checkpoint is written *after*
  ServiceNow succeeds, leaving an untested window where a crash could
  still cause a duplicate (FL-0014, `docs/devex/lessons-learned.md`
  LL-0008) — the recommended next experiment targets exactly that gap.

## Stack

- Node.js + TypeScript
- Trigger mechanism: Salesforce Platform Event via the Pub/Sub API (see
  `docs/decisions/0001-integration-architecture.md`)
- Salesforce auth: OAuth 2.0 JWT Bearer Flow (see
  `docs/decisions/0002-authentication-strategy.md`)
- Pub/Sub API client: `@grpc/grpc-js` + `@grpc/proto-loader` against
  Salesforce's officially published `pubsub_api.proto`
  (`src/salesforce/proto/`), with Avro payload decoding via `avsc`
- ServiceNow auth: OAuth 2.0 Client Credentials grant, dedicated
  `itil`-role user (see `docs/decisions/0004-servicenow-authentication.md`)
- ServiceNow target: Incident, via the Table API
  (`src/servicenow/incidentAdapter.ts`)

## Setup

```
npm install
cp .env.example .env
# fill in .env - see docs/decisions/0002-authentication-strategy.md and
# 0004-servicenow-authentication.md for what each value corresponds to
```

## Run

```
npm run dev

# in another terminal, to test:
npm run publish-test-event -- "Some Distributor Name"
npm run verify-recent-incidents -- 5   # or a correlation ID to filter to one event
```

## Setup / test scripts

Phase 3 (Enablement) candidate from `docs/devex/lessons-learned.md`
LL-0004 — scripting repetitive setup/verification via each platform's own
API beat manual UI clicking. Still local to this service, not a shared
package (premature until a second integration needs the same thing — see
`CLAUDE.md`'s Developer #1 principle).

- `scripts/publish-test-event.ts` — publishes a fully-populated test
  Salesforce event; pass a fixed correlation ID as a third argument to
  republish "the same" event (used to test duplicate delivery, FL-0011)
- `scripts/verify-recent-incidents.ts` — queries ServiceNow for recent (or
  correlation-ID-matched) Incidents, closing the loop without opening the
  ServiceNow UI
- `scripts/create-platform-event-fields.ts` — (re-)creates the canonical
  schema's custom fields on the Platform Event; safe to re-run, fails
  cleanly on fields that already exist
- `scripts/lib/salesforceTooling.ts` — the reusable Tooling API
  `CustomField` creation call, extracted so future schema-setup scripts
  don't re-derive it
- `scripts/get-topic-info.ts` — calls the Pub/Sub API's `GetTopic` RPC and
  prints the raw response; used to verify what Salesforce actually
  exposes (e.g. retention) instead of assuming it (see FL-0013)

## Non-interactive auth setup

The other Phase 3 (Enablement) candidate from LL-0003, also acted on:
platform-specific checklists for setting up service-account OAuth,
written from what actually happened (not idealized steps) —
[`docs/runbooks/salesforce-non-interactive-auth-setup.md`](../../docs/runbooks/salesforce-non-interactive-auth-setup.md)
and
[`docs/runbooks/servicenow-non-interactive-auth-setup.md`](../../docs/runbooks/servicenow-non-interactive-auth-setup.md).

## What's deliberately not here yet

- A general retry / dead-letter / idempotency solution — root causes are
  understood and documented (FL-0011, FL-0012, FL-0014,
  `docs/devex/lessons-learned.md` LL-0005, LL-0006, LL-0008), but no fix
  has been designed or built. The recommended next step is a small,
  targeted experiment (deliberately crash between event processing and
  checkpoint persistence, and observe whether a duplicate results) — see
  LL-0008's "Recommended smallest Phase 3 Enablement experiment." Not the
  same as building the fix itself.
- Tests
- A narrower ServiceNow OAuth Auth Scope (currently relies on the
  dedicated user's `itil` role rather than API-level token scoping — see
  friction-log.md FL-0010)

These are left out per `CLAUDE.md`'s "smallest useful change" principle —
they'll be added once friction shows what's actually needed.
