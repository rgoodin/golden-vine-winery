# 0007. Tier 1 scheduled audit/recovery operational contract

**Status:** Decided (contract only — no scheduler, no automation, and no
code changed as part of this decision; see "Next step" below).
**Supersedes:** nothing. Extends ADR 0005 (the reliability guarantee)
and ADR 0006 (where recovery sources its payload) to the question
neither addressed: what must be true *operationally* before the manual
audit/recovery composition (OB-0028) may run unattended.
**Built on:** `docs/devex/observations.md` OB-0022 (the slow-owner race
this contract explicitly does not try to solve), OB-0026, OB-0027,
OB-0028 (the mechanisms this contract governs, all unmodified by this
decision), and `docs/devex/friction-log.md` FL-0022, FL-0023, FL-0026,
FL-0027 (the specific operational risks this contract responds to).
This document records the contract; the observations/friction entries
have the supporting detail and are cited, not repeated.

## Context

### The question

`npm run detect-unprocessed-events -- --recover=<staleAfterMs>`
(OB-0028) works, verified end-to-end. A human currently decides, every
time they run it, two things: *whether* to run it, and *what
`staleAfterMs` to trust right now*. Automating this - running it
unattended, on a schedule - removes both decisions from a human in the
loop for every individual run. **What operational policy has to exist
first for that removal to be safe, given that "stale" means "eligible
for recovery under policy," not "proven dead" (OB-0022)?**

This is not a request to design or build a scheduler. It is a request
to decide what a scheduler - whenever one is built - would be required
to do, and what a human still must decide once, deliberately, before
any schedule exists.

### Established facts this contract must respect, not re-derive

- Concurrent initial processing and concurrent reclaim are already
  exclusive by construction - a real `PRIMARY KEY`/`UPDATE ... WHERE`
  constraint decides, not a prior read (OB-0017, OB-0021 Case 3,
  re-confirmed under the production store in OB-0026 Case 3 and
  OB-0028). **This means overlapping scheduled runs cannot cause two
  runs to recover the *same* business operation twice** - that
  invariant does not depend on scheduling policy at all. Overlap is
  still an operational concern for other reasons (below), but not a
  correctness one.
- A "stale" `in_flight` operation may still have a genuinely live
  owner mid-call. Reclaiming it and reconciling can produce a real
  duplicate if the original owner then completes independently -
  confirmed deterministically with real independent processes (OB-0022).
  **This contract does not attempt to eliminate that risk.** Tier 1
  (ADR 0005) already accepts it as residual and requires detection, not
  prevention, of the resulting `DUPLICATE`.
- Recovery depends on the source event still being present in
  Salesforce's replayable history, and this project has never
  established that retention horizon (ADR 0006).
- A sweep that returns zero events is not reliable evidence that
  nothing needs auditing - FL-0026 showed a genuine cold-start false
  negative, indistinguishable from a real empty result without a second
  run, which a human happened to perform this time.
- The current tool re-sweeps full history (`ReplayPreset.EARLIEST`)
  every run - there is no incremental "last audited position" (LL-0011,
  still not built). Any failure-handling policy below depends on that
  being true today.
- `DUPLICATE` is never, and must remain never, routed through recovery
  (OB-0026, OB-0028) - this contract does not revisit that.

## Decision

Automating Tier 1's audit/recovery composition requires all of the
following to be explicitly true first. None of these are implemented
by this ADR.

### 1. Cadence is a latency/load tradeoff, not a number this ADR picks

Recovery cadence trades two costs against each other: how long a
genuinely abandoned operation sits unrecovered (a real, if bounded,
window where Tier 1's baseline guarantee isn't yet realized for that
operation) versus how often a full-history sweep and a reconciliation
query per event are run against Salesforce and ServiceNow for no
benefit when there's nothing to recover. **This ADR does not choose a
cadence.** No latency data exists yet for what "acceptable dwell time"
means for this integration, and no load data exists for what sweep
frequency the topic's growing history can sustain without becoming the
next FL-0027-shaped concern. A cadence decision requires that evidence;
gathering it is this ADR's recommended next step (see below), not
something to assume.

### 2. `staleAfterMs` becomes a configured, evidence-justified value — never the experimental one

Once no human reviews the command before it runs, `staleAfterMs` stops
being a parameter a developer types with judgment attached and becomes
a **standing platform policy governing when ownership may be taken from
a possibly-still-live worker** (OB-0022). This ADR decides:

- `staleAfterMs` must be owned by configuration (alongside
  `config.salesforce`/`config.serviceNow` in `src/config.ts` - not
  implemented here), never a CLI-only value, once any scheduled
  invocation exists.
- **The 2000ms value used throughout OB-0020, OB-0021, OB-0026, and
  OB-0028 is experimental instrumentation, chosen to make a test finish
  quickly - it must not become the configured value by default,
  inertia, or omission.**
- A real value requires evidence this project does not yet have:
  measured ServiceNow call latency (the actual distribution, not a
  single anecdotal timing) under realistic conditions, with the
  configured threshold set at a documented safety margin above it. The
  threshold's job is to bound "how long could a legitimate in-flight
  call still plausibly take," not "how long is convenient to wait in a
  test."
- Until that evidence exists and a value is deliberately chosen and
  documented, scheduled recovery must not run. (Scheduled *audit* has
  no such dependency - see #8.)

### 3. Overlapping runs are a load/observability problem, not a correctness one — resolve with skip-if-running

As established above, overlap cannot produce a duplicate recovery of
the same operation - the reclaim gate already prevents that. What
overlap *does* cause: two full Salesforce sweeps and two full
ServiceNow query passes running concurrently for no benefit, and
interleaved output that makes "what did this run actually do" hard to
answer after the fact. **Policy: a scheduled run must not start while a
previous run is still in progress; it should skip and let the next
scheduled tick attempt it instead.** This is a resource/observability
discipline, not a safety mechanism - stated precisely so a future
reader doesn't mistake it for solving OB-0022 by another name.

### 4. A source-sweep anomaly must gate mutating recovery for that run

FL-0026: a run that collects zero events is not evidence that nothing
needs auditing or recovering. **Policy: if a scheduled run's sweep
returns zero events, that run must not proceed to any mutating recovery
action, must not be reported as "0 GAPs found" (a confirming result),
and must instead be flagged as a sweep anomaly requiring attention.**
This ADR deliberately specifies only this one concrete, checkable
trigger (zero events) rather than a general anomaly-detection scheme
(e.g. comparing against a historical baseline) - that would be solving
a problem this project has one data point about, not evidence-based
policy. Widen the trigger only when a second, different anomaly shape
is actually observed.

### 5. Audit and recovery remain independently schedulable — without splitting the code

ADR 0005 makes detection **mandatory** for every Tier 1 integration,
unconditionally. Recovery's automation depends on evidence this project
doesn't have yet (#1, #2). Coupling them into one schedule would force
"no automated detection until recovery policy is fully resolved,"
contradicting ADR 0005's own priority - detection is the baseline
floor; enforcement is the enhancement on top of it. Separately: audit
observes, recovery mutates - a scheduled read-only job and a scheduled
mutating job have different operational risk profiles and should be
controllable independently of each other.

**Policy: audit-only and audit+recovery must be independently
schedulable.** Concretely, this does **not** require splitting
`detect-unprocessed-events.ts` (FL-0027) - the existing
`--recover=<ms>` flag already provides this separation for free: one
scheduled invocation with no `--recover` flag (satisfying ADR 0005's
mandatory floor on its own cadence, no staleness policy required), and,
only once #1/#2's evidence exists and a deliberate decision is made, a
second, separately configured invocation with `--recover=<ms>`. The
flag-gated interface chosen in the previous round (DP-0018 - an
explicit value required, never defaulted) already satisfies this
round's separability requirement without modification.

### 6. Minimum observability per scheduled run

A scheduled run - unlike a manually-watched one - is not being read by
a human as it executes. At minimum, each run must expose, in a durable,
reviewable form (not implemented here - a later decision, not this
ADR's job):

- Total events swept, and the classification tally
  (`UNEVALUABLE`/`GAP`/`OK`/`DUPLICATE` counts) - already printed today,
  just not yet captured anywhere durable.
- When recovery mode is active: recovery-attempted count, recovered
  count, not-recovered count (already printed - OB-0028).
- The sweep-anomaly flag from #4, explicitly, not inferred from an
  absence of other output.
- Overall run status (succeeded / failed), distinct from "succeeded
  and found nothing."
- Enough identity per run (timestamp, at minimum) that two runs' results
  are attributable and comparable - not required for a single manual
  run, required once results are meant to be reviewed after the fact
  rather than watched live.

### 7. Operator-attention conditions — not to be "fixed" automatically

The following must remain visible to a human rather than being silently
absorbed by repeated automatic attempts:

- Any `DUPLICATE` classification - already true today (ADR 0005,
  OB-0028) and unchanged by this ADR; recovery must never be extended
  to touch it.
- A `GAP` that recovery attempted but could not reclaim because no
  local durable record exists at all (FL-0025's shape) - this cannot
  self-resolve by waiting, unlike a `GAP` that's simply not yet stale
  under the threshold, and repeated silent reattempts add no value.
- The same business-operation ID appearing as an unrecovered `GAP`
  across multiple consecutive scheduled runs - a pattern, not a single
  observation, worth a human's attention rather than indefinite
  automatic reattempts.
- Any sweep anomaly (#4).
- Any run failure (#8).

### 8. Failure behavior: fail loudly, do not retry internally — the next scheduled run is the retry

No evidence exists yet about how a scheduled run actually fails in
practice (every run so far has been manual and, failures aside from
FL-0026's anomaly, successful). Per this project's standing practice of
not inventing mechanisms evidence hasn't justified: **a scheduled run
that fails partway - a Salesforce replay error, a ServiceNow query or
reconciliation error, an error recovering one specific operation - must
fail the whole run loudly (non-zero exit, distinct `FAILED` status per
#6) and must not retry internally.** The next scheduled run is the
retry mechanism, and this is sound *because* audit re-sweeps full
history every time (no incremental position exists yet - LL-0011) and
because reconciliation and reclaim are both safe to repeat (OB-0021,
OB-0026, OB-0028) - nothing a partially-completed run touched is left
in an unsafe state for the next run to encounter. **This dependency is
explicit: if LL-0011's incremental audit position is ever built, this
failure policy must be revisited** (see "When to revisit").

## What this decision does not do

- It does not choose a cadence or a `staleAfterMs` value. Both require
  evidence this project doesn't have; inventing either here would be
  exactly the mistake this ADR exists to prevent (OB-0022's own
  lesson, applied to itself).
- It does not attempt to close OB-0022's slow-owner race through
  timeout tuning, heartbeats, or fencing. Tier 1 accepts that residual
  risk; this contract governs how automation may operate *within* that
  accepted risk, not how to eliminate it.
- It does not split `detect-unprocessed-events.ts`. FL-0027's
  responsibilities (sweep, classify, map, recover, two CLI modes)
  remain in one file - automation is satisfied by scheduling the
  existing flag-gated interface twice, independently, not by
  refactoring it.
- It does not build a scheduler, a configuration mechanism for
  `staleAfterMs`, or any durable observability sink. All are named as
  requirements; none are implemented here.

## Consequences

- Scheduled **audit** (no `--recover`) can be enabled as soon as #3
  (skip-if-running), #4 (anomaly guard), #6 (observability), #7
  (operator-attention conditions), and #8 (failure behavior) are
  satisfied for the audit-only path - none of which depend on a chosen
  `staleAfterMs` or cadence value being "correct," only on the policy
  existing.
- Scheduled **recovery** additionally requires #1 (a justified cadence)
  and #2 (a justified, configured `staleAfterMs`) - real evidence this
  project must still gather. Until then, recovery remains manually
  invoked only, exactly as it is today (OB-0028).
- The audit tool's current single-file design (FL-0027) is explicitly
  not a blocker to automation, per #5 - a future developer should not
  read this ADR as implying a refactor is due.
- This ADR creates a dependency from #8's failure policy onto LL-0011
  remaining unbuilt. If that changes, #8 must be re-examined, not
  assumed to still hold.

## When to revisit this ADR

- **LL-0011's incremental audit position is built** - #8's
  failure-retry-via-next-run reasoning depends on full-history resweeps
  and must be re-derived, not assumed to transfer.
- **A second, structurally different sweep anomaly is observed** (not
  another zero-event case) - #4's trigger should widen only on new
  evidence, not preemptively.
- **Real cadence or latency evidence is gathered** (see "Next step") -
  at that point #1 and #2 stop being open questions and this ADR's
  successor (or an amendment) should record the chosen values and their
  justification.
- **Audit-only and recovery observability needs diverge** (e.g.
  different log destinations, different alert routing) - the point at
  which FL-0027's "not yet worth splitting" conclusion should be
  re-checked, per #5's note.

## Next step (Enablement phase — not implemented here)

The smallest automation slice that follows from this contract is
**scheduling audit-only** (`detect-unprocessed-events.ts` with no
`--recover`), not scheduled recovery:

1. It satisfies ADR 0005's mandatory detection requirement, which has
   no dependency on the still-missing cadence/threshold evidence this
   ADR names.
2. It carries no mutation risk - `DUPLICATE` is unaffected either way,
   and no `staleAfterMs` policy decision is required to run it.
3. **It is also how this project gathers the evidence #1 and #2
   require** - real classification tallies over real cadences, and
   real frequency data on sweep anomalies (FL-0026) - before scheduled
   recovery can be responsibly proposed at all. Automating detection
   first is not a smaller version of automating recovery; it is the
   prerequisite measurement phase for it.

Scheduled recovery remains a distinct, later decision, to be proposed
only once #1 and #2 have real evidence behind them - not implemented
as part of this step.
