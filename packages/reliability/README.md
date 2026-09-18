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

## Evidence this behavior is real, not asserted

This package's behavior was established experimentally before
extraction, not invented here. Run the representative experiments
against the consuming service - see
`docs/golden-path/verify.md` in golden-vine-winery, and
`docs/devex/phase-2-observation-review.md` Finding 7 ("Golden Path
reliability experiments should remain visible") for why that matters
more than trusting this README.
