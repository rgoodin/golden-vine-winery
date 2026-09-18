# Create: what you import vs. what you write

Once `docs/golden-path/start.md`'s questions have real answers, scaffold
your integration. This is not a generator (`goldenpath create-integration`
is still conceptual - `CLAUDE.md`, "Golden Path Evolution," Phase 4)
and it is not a template you copy - it's a clear line between what
you'll import unchanged and what you'll write yourself, guided by
`services/integration-service` as the worked example.

## What you import

Two packages, extracted from `services/integration-service` specifically
because they turned out to be genuinely reusable - see
`docs/golden-path/0001-enablement-inventory.md` for why these two and
not others:

- **`golden-path-reliability`** - durable operation ownership: atomic
  acquire, staleness-based reclaim, completion tracking. Target- and
  source-agnostic; it never learns what a "business operation" or a
  "duplicate" means (that's yours - see below). See
  `packages/reliability/README.md`.
- **`golden-path-salesforce-transport`** - Salesforce Pub/Sub API
  connection, authentication, schema resolution, checkpoint-based
  replay resume. Never learns what any event's fields mean. See
  `packages/salesforce-transport/README.md`.

Both are local workspace packages (`npm install` at the repository
root - see `docs/golden-path/configure.md`), not published to any
registry.

## What you write

- **Your canonical business event type** - the shape your source
  system's flat fields map onto. `services/integration-service/src/types/events.ts`
  is the worked example; yours will look different, because it encodes
  *your* business event, not a template's. Keep the same discipline it
  demonstrates: a delivery identifier (`eventId`) and a business-operation
  identifier (`correlationId`) are different things - see Phase 2
  Observation Review, and don't collapse them because it's convenient.
- **Your field mapping** - flat source payload to canonical shape. See
  `services/integration-service/src/salesforce/subscriber.ts`'s
  `toCanonicalEvent()`.
- **Your target adapter** - what a record in your target system looks
  like, and how to create it. See
  `services/integration-service/src/servicenow/incidentAdapter.ts`.
  There is deliberately no generic target-adapter interface to
  implement - one real target isn't enough evidence to know what should
  be shared across targets (Phase 2 Observation Review, "abstractions
  are earned through repetition"). Write a real adapter; don't force it
  into someone else's shape.
- **Your target reconciliation** - given a business-operation ID, does
  the target already have it? See
  `services/integration-service/src/servicenow/incidentReconciliation.ts`.
  This is also where *your* definition of "duplicate" actually lives in
  code - own that definition deliberately (Finding 8).
- **Your orchestration** - acquire → your target action → complete;
  reclaim → your reconciliation → complete-or-create. See
  `services/integration-service/src/processDistributorOnboardingEvent.ts`
  and `recoverStaleDistributorOnboardingOperation.ts` for the pattern.
  The *shape* is reusable; the business action inside each step is not.

## What you don't decide yet

Any recovery cadence, staleness threshold, or scheduling policy -
that's a business/customer risk decision (Finding 11), gated on real
evidence about your integration's own latency and failure patterns, not
inherited from `services/integration-service`'s numbers. See
`docs/decisions/0007-tier1-scheduled-recovery-operational-contract.md`
for why, and don't copy its `staleAfterMs` value as if it were a
default.

Next: `docs/golden-path/configure.md`.
