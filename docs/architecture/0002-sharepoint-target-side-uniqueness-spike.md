# 0002. SharePoint target-side uniqueness spike

**Status:** RESOLVED. See ADR 0009 for the decision this evidence
produced.

## Question

`docs/architecture/0001-reliability-architecture-spike.md` and ADR 0005
established, by direct experiment rather than reasoning, that ServiceNow
never achieves target-side uniqueness enforcement, and that this
project's own local durable-ownership mechanism
(`golden-path-reliability`) has one specific, unclosed gap: the
**slow-owner race** (`docs/devex/observations.md` OB-0022) — a
genuinely slow-but-alive original owner can be reclaimed by a recovery
owner, and both eventually complete their own real side effect,
producing a duplicate the local mechanism has no way to prevent or even
fully remember.

`document-workspace-service`'s SharePoint adapter creates folders with
`"@microsoft.graph.conflictBehavior": "fail"` — a real, server-side
conflict-detection mechanism ServiceNow's Table API never had. This
spike asks, with the same rigor the original used: **does that
mechanism actually provide genuine atomic uniqueness, including under
the exact race that defeated the local mechanism for ServiceNow?**

Per `docs/devex/phase-2-observation-review.md` Finding 12, this
document describes the finding in terms of evidence-backed behavior,
not "Tier 1/Tier 2" labels - the *investigation methodology* mirrors
ADR 0005's, the *terminology* does not carry the same labels forward.

## Round 1 — direct concurrent-create race, no local mechanism involved

**Method:** two genuinely independent OS processes
(`scripts/lib/rawCreateRaceWorker.ts`, spawned by
`scripts/test-concurrent-create-race.ts`), each calling the real,
unmodified production adapter (`createDistributorWorkspaceFolder`) for
the *identical* correlationId/distributor name, started via
`Promise.all` with zero deliberate stagger. `golden-path-reliability`
is not involved at all in this round - it isolates whether SharePoint
itself, under real concurrent load, ever lets two folders with the
same name exist.

**Result: 5/5 iterations produced exactly one success and one real,
independently-verified `409 nameAlreadyExists` conflict.** Every
iteration was confirmed against the live site via `listWorkspaceFolders()`,
not trusted from either worker's own report. No duplicate occurred on
any iteration; which worker (A or B) won each race varied, confirming
this is genuine two-sided contention, not one worker structurally
always losing.

## Round 2 — the slow-owner race, exact reproduction of OB-0022's structure

**Method:** Worker A (`scripts/lib/slowWorkerA.ts`) acquires ownership
via the real `acquireOperation()`, waits 6 seconds (simulating real,
still-in-progress work - not a crash), then calls the real
`createDistributorWorkspaceFolder()`. Worker B
(`scripts/lib/slowWorkerB.ts`) waits 2.5 seconds (past a 2-second
staleness threshold), reclaims via the real `reclaimOperation()`,
reconciles via the real `findDistributorWorkspaceFolder()` - and,
finding nothing yet (because Worker A hasn't called SharePoint yet),
also calls the real `createDistributorWorkspaceFolder()`. Both workers
run as genuinely independent OS processes
(`scripts/test-target-side-uniqueness-race.ts`) against the same
on-disk SQLite store and the same real SharePoint site - the identical
structure that produced a real ServiceNow duplicate 3/3 times.

**Result: 0/3 iterations produced a duplicate.** Every iteration: Worker
B's reconciliation correctly found nothing and proceeded to create the
folder (exactly what the mechanism is designed to do, and exactly the
step that produced ServiceNow's duplicate); Worker B's create
succeeded; Worker A's later, delayed create attempt failed with a real,
independently-verified `409 nameAlreadyExists` - not a timeout, not a
silent no-op, a genuine server-side conflict rejection. The local
durable record correctly reflects the one folder that actually exists
in all three iterations.

## Conclusion

For the specific action this integration performs - creating a
distributor workspace folder with a deterministic, correlationId-derived
name - SharePoint's `conflictBehavior: "fail"` provides real,
evidence-backed atomic uniqueness enforcement, including under the
exact concurrent-ownership race that this project directly confirmed
defeats the local reliability mechanism for ServiceNow. This is a
genuinely stronger reliability property than either integration could
claim before this spike: `document-workspace-service`'s
folder-creation action can honestly be described as achieving
exactly-once behavior at the target, not merely recoverable
at-least-once processing paired with after-the-fact audit detection.

This conclusion is scoped narrowly, on purpose: it applies to this one
action (create-with-`conflictBehavior:"fail"` against a
deterministically-named child item), not to SharePoint or Microsoft
Graph in general, and not to any other action this or a future
integration might perform against it. See ADR 0009 for the recorded
decision and its own explicit scope boundary.

## What this spike did not do

- It did not change any production code. `golden-path-reliability`,
  the SharePoint adapter, and the recovery orchestration are exactly as
  they were before this spike ran.
- It did not simplify or remove reconciliation/recovery logic on the
  strength of this finding. Whether that's worth doing is a separate,
  later, explicitly-approved decision - flagged as a candidate in
  ADR 0009, not acted on here.
- It did not test any other Graph/SharePoint operation for the same
  property - only folder creation with `conflictBehavior: "fail"` was
  investigated.
- All 8 folders created by these experiments (5 from Round 1, 3 from
  Round 2) were deleted after each round's evidence was independently
  verified and recorded above - they were experiment residue, not
  meaningful business data worth preserving.
