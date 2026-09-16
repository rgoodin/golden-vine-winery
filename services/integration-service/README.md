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
`docs/devex/observations.md` (OB-0001–OB-0012) and
`docs/devex/friction-log.md` (FL-0001–FL-0017).

Several known gaps were deliberately tested rather than assumed:

- **Duplicate delivery** (FL-0011): confirmed — no idempotency boundary
  exists anywhere, not fixed.
- **Crash recovery** (FL-0012): a minimal replay-checkpoint experiment
  (`src/salesforce/checkpoint.ts`) confirmed an event published while the
  service is offline **can** be recovered via `ReplayPreset.CUSTOM` — see
  `docs/devex/observations.md` OB-0008.
- **Both possible checkpoint orderings' failure modes are confirmed and
  compared (LL-0009)**: checkpointing *after* calling ServiceNow (current
  default) causes a **duplicate** Incident if a crash lands between the
  two (FL-0015, OB-0009); checkpointing *before* calling ServiceNow
  instead causes a **silent loss** — no Incident ever created (FL-0016,
  OB-0010).
- **A working audit tool now detects both failure modes** (LL-0010,
  LL-0011): `scripts/detect-unprocessed-events.ts` replays Salesforce
  events (via a known position or a full `ReplayPreset.EARLIEST` sweep)
  and classifies each as `GAP` / `OK` / `DUPLICATE` / `UNEVALUABLE`
  against ServiceNow. Validated against this project's complete 11-event
  history with **zero discrepancies** from the independently-predicted
  result (OB-0012). Still an on-demand experimental/audit instrument, not
  wired into any runtime path.

None of this is a production reliability feature — the checkpoint
mechanism and the detector are both working experiments, and no
architecture has been chosen yet.

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
- `scripts/detect-unprocessed-events.ts` — read-only reconciliation:
  replays Salesforce events (`npm run detect-unprocessed-events` sweeps
  from `EARLIEST`; pass a specific replay ID to check from a known
  position instead) and counts matching ServiceNow Incidents per
  `correlationId`, classifying each as `GAP` (0), `OK` (1), `DUPLICATE`
  (>1, with Incident numbers as evidence), or `UNEVALUABLE` (no
  `Correlation_Id__c` - predates that field, not treated as a gap).
  Validated against the complete known event history with zero
  discrepancies (see FL-0017, OB-0011, OB-0012, LL-0010, LL-0011).
  Experimental/audit only - not run automatically.
- `scripts/test-servicenow-concurrent-idempotency.ts` — controlled
  concurrency experiment for the ServiceNow target-side idempotency
  investigation: fires two Incident-create requests for the same
  business-operation ID via `Promise.all` (genuinely concurrent, not
  lookup-then-create) against `u_gv_business_operation_id`, then
  independently re-queries ServiceNow to see how many Incidents actually
  resulted. Result and analysis: FL-0018, OB-0014,
  `docs/architecture/0001-reliability-architecture-spike.md` §3b.
  Experimental only - does not touch the subscriber or `incidentAdapter.ts`.
- `scripts/lib/idempotencyStore.ts` + `scripts/test-durable-state-concurrent-idempotency.ts`
  + `scripts/test-durable-state-crash-gap.ts` — investigation-only
  prototype of the integration-owned durable-state candidate (`node:sqlite`,
  zero new dependency, a real `PRIMARY KEY` constraint as the atomic
  create-if-absent gate — not lookup-then-create). One script repeats
  the concurrency experiment above against this local store instead of
  ServiceNow (5/5 clean trials — OB-0017); the other simulates a crash
  between acquiring ownership and calling ServiceNow, confirming that
  doing so causes permanent silent loss unless a reclaim mechanism is
  added, which was not built (OB-0018). Not wired into `src/` or any
  runtime path; writes to a local, gitignored `.idempotency-experiment.sqlite`
  file. Full analysis:
  `docs/architecture/0001-reliability-architecture-spike.md` §4
  ("C-prototype"), `docs/devex/lessons-learned.md` LL-0013.
- `scripts/test-durable-state-reclaim-ambiguity.ts` — direct follow-up:
  can a stale `in_flight` record from the crash-gap experiment above be
  safely reclaimed? Adds one function to `idempotencyStore.ts`,
  `reclaim()` (an atomic, conditional elapsed-time check - not a
  lease/heartbeat framework), then produces two crashed operations with
  an *identical* durable-record shape via two different real paths (one
  that never called ServiceNow, one where ServiceNow genuinely succeeded
  before the crash) and reclaims both the same way. Result: the
  genuinely-abandoned one recovers correctly (exactly one Incident); the
  one where ServiceNow already succeeded gets a second, duplicate
  Incident from the naive retry - confirming elapsed time alone cannot
  distinguish the two cases (OB-0020). Full analysis:
  `docs/architecture/0001-reliability-architecture-spike.md` §4
  ("C-reclaim"), `docs/devex/lessons-learned.md` LL-0015.
- `scripts/test-durable-state-reclaim-reconciliation.ts` — direct
  follow-up: does querying ServiceNow by business-operation ID during
  reclaim (target reconciliation) resolve the ambiguity above? Repeats
  the same two cases, and on reclaim queries ServiceNow first — found
  means record that Incident as completion, don't create; absent means
  create, then record. Result: both cases recover to exactly one
  Incident, independently verified (the crash-after case is confirmed
  to reuse the *original* Incident's `sys_id`, not create a new one).
  Extended with a third case — two concurrent `reclaim()` calls against
  the same stale record — confirming exactly one recovery owner, same
  as `acquire()`. Explicitly does **not** establish anything about a
  genuinely concurrent "slow worker, not dead" race (this script runs
  everything sequentially in one process) — left open on purpose
  (OB-0021). Full analysis:
  `docs/architecture/0001-reliability-architecture-spike.md` §4
  ("C-reconciliation"), `docs/devex/lessons-learned.md` LL-0016.
- `scripts/lib/slowWorkerA.ts` + `scripts/lib/slowWorkerB.ts` +
  `scripts/test-durable-state-slow-worker-race.ts` — direct follow-up:
  reproduces the "slow worker, not dead" race OB-0021 left open, using
  genuinely independent OS processes (`child_process.spawn`, each its
  own Node runtime), not a single-process simulation. Worker A acquires
  and waits 6s before calling ServiceNow for real (simulating real
  in-progress work); Worker B starts ~300ms later, waits past the
  staleness threshold, reclaims, reconciles (finds nothing, since Worker
  A hasn't completed), and creates its own Incident. Result: **2 real
  Incidents for the same business-operation ID, independently verified,
  3/3 iterations** — deterministic, not a scheduling fluke, given the
  wide fixed timing margin. Worse than a plain duplicate: the *local*
  record afterward shows only one Incident (whichever worker completed
  last, silently overwriting the other — no fencing token exists to
  prevent this), so the record ends up actively wrong, not merely
  incomplete. Full analysis:
  `docs/architecture/0001-reliability-architecture-spike.md` §4
  ("C-slow-owner-race"), `docs/devex/lessons-learned.md` LL-0017.
- `scripts/test-servicenow-conditional-create.ts` — direct follow-up:
  does ServiceNow's Table API (or another directly usable API) let the
  *target* atomically reject a stale create - not a client-side lookup
  (OB-0014) or a client-side fencing check (OB-0022), but ServiceNow's
  own transaction? Probes real `ETag`/`Last-Modified` header presence,
  whether `If-None-Match: *` on `POST` has any effect, and whether `PUT`
  can create a not-yet-existing record. Result: **confirmed no** - no
  version header exists to condition on, `If-None-Match: *` is silently
  ignored (two concurrent creates carrying it both still succeed,
  independently verified), and `PUT` to an unused `sys_id` returns
  `404` (update-only, no upsert path). Matches ServiceNow's own official
  Table API reference, which documents no conditional-request headers
  for any operation. Full analysis:
  `docs/architecture/0001-reliability-architecture-spike.md` §3c,
  `docs/devex/lessons-learned.md` LL-0018.
- `EXPERIMENT_CRASH_BEFORE_CHECKPOINT=true npm run dev` — deterministic
  test-only crash point in `pubsubClient.ts`: exits right after an event
  is successfully processed but before its checkpoint is persisted, for
  reproducing the FL-0014/FL-0015 duplicate-on-crash scenario. Off by
  default; changes no normal-path behavior.
- `EXPERIMENT_CHECKPOINT_BEFORE_SERVICENOW=true npm run dev` —
  deterministic test-only fault injection that reverses the normal order
  for one event: persists the checkpoint, then exits *before* ServiceNow
  is ever called, reproducing the FL-0016/OB-0010 silent-loss scenario.
  Mutually exclusive with the flag above; off by default, changes no
  normal-path behavior.

## Non-interactive auth setup

The other Phase 3 (Enablement) candidate from LL-0003, also acted on:
platform-specific checklists for setting up service-account OAuth,
written from what actually happened (not idealized steps) —
[`docs/runbooks/salesforce-non-interactive-auth-setup.md`](../../docs/runbooks/salesforce-non-interactive-auth-setup.md)
and
[`docs/runbooks/servicenow-non-interactive-auth-setup.md`](../../docs/runbooks/servicenow-non-interactive-auth-setup.md).

## What's deliberately not here yet

- A general retry / dead-letter / idempotency solution — root causes are
  understood and both failure modes (duplicate, silent loss) are
  reliably detectable via a validated diagnostic tool (FL-0011,
  FL-0012, FL-0014–FL-0017, `docs/devex/lessons-learned.md` LL-0005,
  LL-0006, LL-0008–LL-0011). A reliability architecture spike
  ([`docs/architecture/0001-reliability-architecture-spike.md`](../../docs/architecture/0001-reliability-architecture-spike.md),
  now RESOLVED) tested both strongest candidates directly across eight
  follow-up rounds rather than reasoning about them: ServiceNow itself
  never achieved a verified uniqueness-enforcement mechanism (FL-0018,
  OB-0016, OB-0019, OB-0023 - including confirming no conditional-write
  API exists to fall back on), and a `node:sqlite` durable-ownership
  prototype (`scripts/lib/idempotencyStore.ts`) closes every reproduced
  sequential crash boundary (OB-0017, OB-0021) but is defeated by a
  genuinely concurrent "slow owner, not dead" race, confirmed with real
  independent processes (OB-0022). **That investigation is now decided:
  [ADR 0005](../../docs/decisions/0005-external-side-effect-reliability-contract.md)
  adopts a two-tier reliability contract** - a mandatory baseline
  (recoverable at-least-once processing paired with audit-based
  detection of any residual gap/duplicate, not exactly-once) available
  for any target, and an opt-in stronger guarantee (exactly-once
  external effects) only for a target *proven* to enforce uniqueness
  itself - which ServiceNow has not done here. **Nothing in the ADR has
  been implemented** - the baseline mechanisms above remain experimental
  scripts, not wired into `src/`.
- Giving the audit tool its own incremental "last audited position" so
  repeat runs don't always re-sweep from `EARLIEST` (LL-0011) - proposed,
  not built.
- Tests
- A narrower ServiceNow OAuth Auth Scope (currently relies on the
  dedicated user's `itil` role rather than API-level token scoping — see
  friction-log.md FL-0010)

These are left out per `CLAUDE.md`'s "smallest useful change" principle —
they'll be added once friction shows what's actually needed.
