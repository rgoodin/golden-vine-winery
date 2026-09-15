# Integration Service

Receives `DistributorOnboardingRequested` events from Salesforce and (once
built) forwards them to a ServiceNow adapter. See the root
[`CLAUDE.md`](../../CLAUDE.md) for the full architecture and phase roadmap.

## Status: Phase 1, auth + Pub/Sub client working, not yet tested end-to-end

The Salesforce Pub/Sub API subscriber is implemented and authenticates
successfully against the real dev org (JWT bearer flow, gRPC/TLS). It
cannot yet prove a full event flow because the
`DistributorOnboardingRequested__e` Platform Event doesn't exist in
Salesforce yet — see `docs/devex/friction-log.md` (FL-0004).

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
```

## What's deliberately not here yet

- The `DistributorOnboardingRequested__e` Platform Event object in
  Salesforce (FL-0004) — without it, there's nothing to actually subscribe
  to yet
- Mapping the Platform Event's real (flat) fields onto the canonical
  nested event shape in `src/types/events.ts`
- ServiceNow adapter
- Retry / dead-letter handling
- Idempotency handling
- Tests

These are left out per `CLAUDE.md`'s "smallest useful change" principle —
they'll be added once Phase 1 friction shows what's actually needed.
