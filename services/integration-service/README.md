# Integration Service

Receives `DistributorOnboardingRequested` events from Salesforce and (once
built) forwards them to a ServiceNow adapter. See the root
[`CLAUDE.md`](../../CLAUDE.md) for the full architecture and phase roadmap.

## Status: Phase 1, scaffolding only

This service does not work yet. It exists to prove out the smallest useful
slice — receiving one real event from Salesforce — before anything else is
built. See `docs/devex/friction-log.md` (FL-0001) for what's currently
blocking that.

## Stack

- Node.js + TypeScript
- Trigger mechanism: Salesforce Platform Event via the Pub/Sub API (see
  `docs/devex/decisions.md` DEC-0002)

## Setup

```
npm install
cp .env.example .env
# fill in .env - see open questions in docs/devex/friction-log.md FL-0001
```

## Run

```
npm run dev
```

## What's deliberately not here yet

- Salesforce Pub/Sub API authentication and gRPC client (open friction item,
  FL-0001)
- ServiceNow adapter
- Retry / dead-letter handling
- Idempotency handling
- Tests

These are left out per `CLAUDE.md`'s "smallest useful change" principle —
they'll be added once Phase 1 friction shows what's actually needed.
