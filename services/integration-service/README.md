# Integration Service

Receives `DistributorOnboardingRequested` events from Salesforce and (once
built) forwards them to a ServiceNow adapter. See the root
[`CLAUDE.md`](../../CLAUDE.md) for the full architecture and phase roadmap.

## Status: Phase 1, first event proven end-to-end

The Salesforce Pub/Sub API subscriber authenticates (JWT bearer flow) and
receives real events from the dev org. A minimal
`Distributor_Onboarding_Requested__e` Platform Event (one field,
`Distributor_Name__c`) exists in Salesforce, and publishing a test event
via `npm run publish-test-event` has been confirmed to reach the
subscriber. See `docs/devex/observations.md` (OB-0004) and
`docs/devex/friction-log.md` (FL-0001–FL-0006).

Still not built: the full canonical event schema (only one field exists
so far), mapping onto `src/types/events.ts`'s nested shape, and everything
past the subscriber (ServiceNow adapter, retries, idempotency).

## Stack

- Node.js + TypeScript
- Trigger mechanism: Salesforce Platform Event via the Pub/Sub API (see
  `docs/decisions/0001-integration-architecture.md`)
- Auth: OAuth 2.0 JWT Bearer Flow (see
  `docs/decisions/0002-authentication-strategy.md`)
- Pub/Sub API client: `@grpc/grpc-js` + `@grpc/proto-loader` against
  Salesforce's officially published `pubsub_api.proto`
  (`src/salesforce/proto/`), with Avro payload decoding via `avsc`

## Setup

```
npm install
cp .env.example .env
# fill in .env - see docs/decisions/0002-authentication-strategy.md for
# what each Salesforce-side value corresponds to
```

## Run

```
npm run dev

# in another terminal, to test:
npm run publish-test-event -- "Some Distributor Name"
```

## What's deliberately not here yet

- The rest of the canonical event's fields on the Platform Event object
  (only `Distributor_Name__c` exists so far)
- Mapping the Platform Event's real (flat) fields onto the canonical
  nested event shape in `src/types/events.ts`
- ServiceNow adapter
- Retry / dead-letter handling
- Idempotency handling
- Tests

These are left out per `CLAUDE.md`'s "smallest useful change" principle —
they'll be added once Phase 1 friction shows what's actually needed.
