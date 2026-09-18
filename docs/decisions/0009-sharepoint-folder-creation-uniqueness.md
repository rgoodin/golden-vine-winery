# 0009. SharePoint workspace-folder creation achieves evidence-backed exactly-once behavior

## Context

ADR 0005 adopted, for the Salesforce → ServiceNow integration, a
reliability model built on recoverable at-least-once processing paired
with audit-based detection of any residual gap or duplicate -
explicitly not exactly-once, because direct experiment showed neither
ServiceNow itself nor this project's own local durable-ownership
mechanism could guarantee it: a genuinely slow-but-alive original owner
can be reclaimed by a recovery owner, and both eventually complete
their own real side effect (`docs/devex/observations.md` OB-0022, the
"slow-owner race").

`document-workspace-service`'s SharePoint adapter creates folders with
`"@microsoft.graph.conflictBehavior": "fail"` -
a mechanism ServiceNow's Table API never had.
`docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md`
tested directly whether this actually closes the exact race that
defeats the local mechanism, rather than assuming it from the
documentation.

Per `docs/devex/phase-2-observation-review.md` Finding 12, this ADR
describes the finding as evidence-backed behavior, not as "Tier 2" -
that label is not part of this project's current reliability-claims
vocabulary, even though the question being answered is the same kind
ADR 0005 answered for ServiceNow.

## Decision

**For the specific action `createDistributorWorkspaceFolder()`
performs — creating a child item with a deterministic,
correlationId-derived name under `conflictBehavior: "fail"` — this
integration can claim genuine exactly-once target-side behavior,
backed by direct experimental evidence, not by trusting Microsoft's
documentation or by reasoning about the API's design.**

The evidence: two rounds of live experiments against the real
SharePoint site (`docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md`).
Round 1 (5/5 iterations, no local mechanism involved) confirmed direct
concurrent-create races always resolve to exactly one success and one
clean, independently-verified `409 nameAlreadyExists` conflict. Round 2
(3/3 iterations) reproduced OB-0022's exact slow-owner race - the same
structure that produced a real ServiceNow duplicate 3/3 times - and
found zero duplicates: SharePoint's own conflict detection rejected the
second, later create attempt every time, independently verified against
the live site, not inferred from either worker's own report.

This is a narrower, but genuinely stronger, claim than ADR 0005 makes
for ServiceNow. It is not a claim about SharePoint or Microsoft Graph
in general - only about this one action, tested this way, this many
times.

## Alternatives considered

- **Assume the documented behavior of `conflictBehavior: "fail"` without
  testing it.** Rejected - this project's own standard, established by
  the original ServiceNow investigation, is that reliability properties
  are earned by direct experiment, not documentation ("Golden Path
  reliability experiments should remain visible,"
  `docs/devex/phase-2-observation-review.md` Finding 7). Assuming this
  one held would have been exactly the shortcut that standard exists to
  prevent.
- **Treat this the same as ServiceNow's result (no exactly-once claim)
  out of consistency between the two integrations.** Rejected - the
  reliability model this project has adopted is explicitly per-target,
  evidence-based, not a fixed policy applied uniformly regardless of
  what each target actually does
  (`docs/golden-path/0002-design-principles.md`: "here is the evidence,
  do not claim a stronger property than it supports" applies equally to
  *not* claiming a weaker one once real evidence supports more).

## Consequences

- `document-workspace-service`'s folder-creation action has a
  genuinely stronger, evidence-backed reliability claim than either
  integration could make before this spike - worth stating plainly in
  the service's own documentation, not just in this ADR.
- **This does not simplify or remove `golden-path-reliability`,
  reconciliation, or recovery logic - none of that changed as part of
  this decision.** Whether the recovery orchestration could be
  meaningfully simplified given a target that enforces its own
  uniqueness (e.g., treating a `409` on create as equivalent to a
  successful reconciliation find, rather than requiring a separate
  lookup first) is a real, interesting follow-up question this evidence
  raises - explicitly flagged here as a candidate for a separate, later,
  explicitly-approved round, not decided or acted on by this ADR.
- This conclusion is scoped to exactly the action tested. A future
  SharePoint action (updating a folder, creating a different kind of
  item, a different conflict-behavior setting) earns its own evidence
  before any similar claim is made about it - this ADR does not
  generalize to "SharePoint is safe."
- Audit-based detection (`scripts/detect-unprocessed-events.ts`,
  OB-0033) remains valuable regardless of this finding - it is the
  mechanism that would catch a violation of this claim should one ever
  occur (a regression in Graph's own behavior, a future code change
  that bypasses the adapter, etc.), not a mechanism this decision makes
  redundant.
