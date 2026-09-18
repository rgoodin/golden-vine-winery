# Golden Path Design Principles

**Status:** Design philosophy, not an implementation plan. No Golden
Path capability has been scaffolded or extracted as a result of this
document.

**Authority:** these principles are downstream of, and must be read
together with, `docs/devex/phase-2-observation-review.md` — that
document records *why* each principle below was concluded, with
citations to the underlying evidence. This document restates them as
design principles for whoever builds the Golden Path next; it is not
itself the source of new requirements.

`docs/golden-path/0001-enablement-inventory.md` remains a separate
document: an *analysis* of what in the current implementation is
business-specific vs. reusable vs. platform-owned vs. teaching material
vs. historical. It is input to a future Enablement decision, not a
backlog, and not the source these principles are derived from — the
Observation Review is.

---

## It's a Golden Path, not a gold watch

The Golden Path does not guarantee that a given implementation
satisfies a customer's requirements. It provides:

- evidence-backed implementation,
- known, documented behavior,
- runnable experiments that established that behavior,
- documented limitations, and
- guardrails.

The consuming developer determines whether those observed
characteristics satisfy their customer's actual requirements, in their
actual architecture. The Golden Path gives them evidence to make that
determination with — it does not make the determination for them, and
it must never be described or built as though it does.

This is Phase 2 Observation Review Finding 9. It is the single most
important sentence in this document; every principle below is a
consequence of taking it seriously.

## Evidence travels with the Golden Path

Reusable implementation without the experiments that established its
behavior is incomplete enablement. A Golden Path capability is not
"done" when the code is extracted — it is done when the code *and* a
runnable way to observe its behavior are both available to the next
developer. See Finding 7: Developer #2 should be able to run duplicate-
delivery, crash-boundary, and concurrency experiments against their own
integration, not just read a claim that the mechanism handles them.

## Hide accidental complexity, not legitimate decisions

Transport plumbing — gRPC connection setup, schema resolution, replay
mechanics — is a candidate for Platform ownership, because a developer
gains nothing from re-deriving it (Finding 3). Business-operation
semantics — what identifies an operation, what counts as a duplicate —
and customer risk decisions — recovery thresholds, acceptable dwell
time — are not accidental complexity, and must not be hidden inside
platform code merely because doing so would make an interface look
simpler (Findings 8, 11). A Golden Path that hides a business decision
has not simplified anything; it has relocated the decision somewhere
the developer can no longer see it being made.

## Recovery capability is not recovery authority

A mechanism being technically able to reclaim and recover a stale
operation does not mean the platform is authorized to decide *when* to
exercise that capability. That decision belongs to whoever owns the
risk of getting it wrong — the business/customer, not Platform
(Finding 11). Platform's job is to make the capability available,
observable, and safely bounded (see
`docs/decisions/0007-tier1-scheduled-recovery-operational-contract.md`
for what "safely bounded" required in practice), not to exercise
judgment that isn't Platform's to exercise.

## Standardization is evidence-driven

Something being technically automatable does not by itself justify
making it platform self-service. ServiceNow machine-identity and OAuth
configuration is the concrete example: technically scriptable, but
deliberately left as a human-run runbook because no evidence yet
justifies removing a human review step from a platform-wide security
configuration change (Finding 5). The bar for standardizing something
is repeated, real friction — not merely the absence of a technical
obstacle.

## Abstractions are earned through repetition

One ServiceNow target is insufficient evidence for a generalized
target-adapter framework. `src/servicenow/incidentAdapter.ts` and
`incidentReconciliation.ts` look like they suggest an interface, and
they might be one eventually — but locking that interface in now, from
a sample size of one, risks generalizing the wrong boundary and forcing
every future target to bend to ServiceNow's shape
(`docs/golden-path/0001-enablement-inventory.md`, Unresolved). The same
applies to the canonical event's base shape (Finding 6) and to the
audit tool's classification logic. Wait for a second real
implementation before deciding what was actually shared.

## A developer can reject the Golden Path

Use of the Golden Path is encouraged, not mandatory. A developer may
determine, with evidence, that it doesn't fit their customer's
requirement. That evidence should come back to Platform/Dojo before the
developer silently works around the path, whenever practical (Finding
10) — not because the developer needs permission to deviate, but
because an unreported deviation is a lost observation, and a reported
one is exactly the kind of material this project's whole cycle exists
to capture. A justified exception is a success of the process, not a
failure to comply with it.

---

## What this document does not do

- It does not choose which specific modules get extracted first, or in
  what order. That is an implementation decision for a future,
  explicitly-scoped Enablement round.
- It does not supersede or replace
  `docs/golden-path/0001-enablement-inventory.md`'s classification.
- It does not reopen or restate the reliability architecture itself —
  see `docs/decisions/0005-external-side-effect-reliability-contract.md`
  through `0007` for that, and Phase 2 Observation Review Finding 12
  for how their terminology should and shouldn't carry forward.
