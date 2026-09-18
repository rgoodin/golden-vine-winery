# golden-path-reliability

Target/source-agnostic durable operation ownership: atomic
create-if-absent, staleness-based reclaim, and completion tracking for a
business operation identified by an opaque string ID.

Extracted from `golden-vine-winery/services/integration-service` as the
first Golden Path Enablement slice - see
`docs/golden-path/0001-enablement-inventory.md`,
`docs/golden-path/0002-design-principles.md`, and
`docs/devex/phase-2-observation-review.md` in that repository for why
this specific module, and not others, was judged reusable.

## What this package knows, and deliberately does not know

It knows: whether a business operation ID is currently owned
(`in_flight`), stale enough to reclaim under a caller-supplied
threshold, or `completed`, and (once completed) the two opaque strings
the caller recorded as evidence of what happened.

It does not know, and must never be extended to know: what a "business
operation" or a "duplicate" *means* for your integration, what target
system you're protecting, or what threshold is safe to reclaim after.
Those are business/customer decisions - see this repository's
`docs/golden-path/ownership-boundaries.md`. This package only carries
identity and state; it never originates it.

## API

```ts
import {
  acquireOperation,
  reclaimOperation,
  completeOperation,
  getOperation,
} from 'golden-path-reliability';

acquireOperation(businessOperationId: string): boolean
reclaimOperation(businessOperationId: string, staleAfterMs: number): boolean
completeOperation(businessOperationId: string, evidenceId: string, evidenceLabel: string): void
getOperation(businessOperationId: string): OperationRecord | null
```

`acquireOperation` and `reclaimOperation` return `true` only for the
single caller whose database write actually took effect - the
constraint decides, never a prior read. `staleAfterMs` has no default;
choosing it is a caller decision, not this package's.

## Storage

A `node:sqlite` database at `<cwd>/.idempotency.sqlite` - relative to
wherever the *consuming* process runs, not to this package. Each
service that imports this package gets its own store for free, with no
required configuration. Requires Node 22+ (`node:sqlite` is
experimental as of this writing).

## Testing

`npm test` (from here, or `npm test` at the repository root, which runs
every workspace's tests together) - fast, local, mock-free unit tests
(`node:test`) against a real local SQLite database. Covers this
package's own documented behavior (acquire/reclaim/complete/get,
including the "constraint decides, not a prior read" properties). Does
**not** re-test genuine multi-process concurrency (OB-0017's 5/5
trials, OB-0022's slow-owner race) - a single-process unit test can't
exercise real OS-level concurrency. That evidence lives in
golden-vine-winery's `scripts/test-production-concurrent-idempotency.ts`
and `scripts/lib/slowWorkerA.ts`/`slowWorkerB.ts`, run against real
systems - see below.

## Evidence this behavior is real, not asserted

This package's behavior was established experimentally before
extraction, not invented here. Run the representative experiments
against the consuming service - see
`docs/golden-path/verify.md` in golden-vine-winery, and
`docs/devex/phase-2-observation-review.md` Finding 7 ("Golden Path
reliability experiments should remain visible") for why that matters
more than trusting this README.
