# 0005. Reliability contract for non-transactional external side effects

**Status:** Decided (architecture only — not implemented; see "Next step"
below).
**Supersedes:** nothing. Extends ADR 0001–0004, which established *how*
this integration talks to Salesforce and ServiceNow, not what it
guarantees when a side effect can fail partway through.
**Built on:** `docs/architecture/0001-reliability-architecture-spike.md`
(full investigation) and the DevEx journal entries cited throughout,
particularly `docs/devex/observations.md` OB-0014, OB-0017, OB-0018,
OB-0021, OB-0022, OB-0023, and `docs/devex/lessons-learned.md` LL-0009,
LL-0014, LL-0017, LL-0018. This document reconstructs the evidence
chain concisely and cites those records rather than repeating them.

## Context

### The question

What reliability guarantee should the Golden Path promise when a
business operation requires a **non-transactional external side
effect** — here, creating a ServiceNow Incident — that cannot be rolled
back if the integration crashes partway through?

### The evidence chain

This project did not design for this question in advance. Each link
below was independently reproduced, not assumed, before the next one
was investigated:

```
source delivery/replay
      ↓
checkpoint ordering
      ↓
duplicate vs loss windows
      ↓
atomic durable ownership
      ↓
crash recovery
      ↓
reclaim
      ↓
target reconciliation
      ↓
slow-owner race
      ↓
target enforcement investigation
```

- **Source delivery/replay.** Salesforce's Pub/Sub API is at-least-once
  at the transport layer: a `ReplayPreset.CUSTOM` checkpoint correctly
  recovers an event published while the subscriber was offline
  (`docs/devex/observations.md` OB-0008), and redelivery after a crash
  is real, not hypothetical (FL-0014/FL-0015).
- **Checkpoint ordering.** Both possible orderings of "call ServiceNow"
  vs. "persist the replay checkpoint" were directly tested. Checkpoint-
  after-ServiceNow causes a **duplicate** Incident on a crash
  (FL-0015, OB-0009); checkpoint-before-ServiceNow causes a **silent
  loss** instead — no Incident, no log trail (FL-0016, OB-0010).
- **Duplicate vs. loss windows.** Neither ordering is simply safer
  (LL-0009): every single-boundary checkpoint design trades one failure
  window for the other. This is what motivated the reliability
  architecture spike in the first place.
- **Atomic durable ownership.** An integration-owned datastore
  (`services/integration-service/scripts/lib/idempotencyStore.ts`, a
  `node:sqlite` `PRIMARY KEY` as the atomic gate) was prototyped and
  shown to prevent **concurrent** duplicate processing attempts for the
  same business-operation ID, 5/5 clean trials, by construction, not by
  luck (OB-0017).
- **Crash recovery.** The same prototype, without a recovery mechanism,
  produces **permanent silent loss** if the process crashes between
  acquiring ownership and calling ServiceNow (OB-0018) — the same
  lesson as the checkpoint-ordering finding, now confirmed at this
  layer too.
- **Reclaim.** A bare, elapsed-time-only reclaim mechanism was built and
  tested and found **necessary but not sufficient**: it recovers a
  genuinely abandoned operation correctly, but reintroduces a duplicate
  whenever the "crash" is actually a completed ServiceNow call the
  local record never recorded — because elapsed time alone cannot
  distinguish those two cases (OB-0020).
- **Target reconciliation.** Querying ServiceNow directly by
  business-operation ID during reclaim — rather than naively retrying —
  was built and tested against both reproduced crash boundaries and
  closed both of them, independently verified, including under
  concurrent reclaim attempts (OB-0021).
- **Slow-owner race.** The same mechanism was then tested against a
  genuinely concurrent scenario — not a crash, a worker that is merely
  *slow* — using two real, independent OS processes. **Confirmed unsafe,
  deterministically, 3/3 iterations**: two real Incidents result, and
  the local record ends up actively wrong afterward, not just
  incomplete (OB-0022).
- **Target enforcement investigation.** Whether ServiceNow itself could
  close that gap was then asked directly, not left as inference.
  **Confirmed no**, for every mechanism reachable without writing new
  ServiceNow server-side code: no conditional-write support on the
  Table API (documented and directly tested), Import Set coalesce is
  not atomic (corroborated), GraphQL mutations require custom
  server-side resolvers to even attempt (OB-0023). Combined with the
  still-unresolved schema-level unique-index investigation
  (FL-0018, OB-0019), this project has checked every standard,
  non-custom-scripted door for ServiceNow-side write enforcement.

### Terminology

This investigation repeatedly found informal language collapsing
distinctions that mattered. This ADR uses these terms precisely:

- **Message delivery semantics** — what the *source* (Salesforce
  Pub/Sub) guarantees about an event reaching this subscriber.
  Established: at-least-once, not exactly-once (OB-0008,
  FL-0014/FL-0015).
- **Processing ownership** — which worker is currently responsible for
  acting on a business operation, right now. A purely local,
  integration-side bookkeeping fact (`acquire()`/`reclaim()`). Says
  nothing on its own about whether the external side effect happened.
- **Business-operation identity** — the identifier
  (`Correlation_Id__c` / `u_gv_business_operation_id`) used to
  recognize that two deliveries represent the *same* real-world
  operation. Necessary for everything above it in the chain; its own
  upstream production contract remains unwritten
  (`docs/architecture/0001-reliability-architecture-spike.md` §2).
- **External side-effect idempotency** — whether performing the same
  business operation's side effect twice results in only one
  persisted effect *at the target*. This is the property OB-0014 and
  OB-0023 show ServiceNow does not provide by itself.
- **Reconciliation** — comparing local state against target state,
  either periodically (the audit tool, OB-0012) or at a specific
  decision point (during reclaim, OB-0021), to detect or resolve
  divergence. Proven to close two of the three demonstrated failure
  windows (OB-0021); proven **not** to close the third (OB-0022).
- **Exactly-once processing** — the *local* guarantee that this
  integration's own logic runs to completion for a business operation
  exactly once. Achievable, and substantially achieved for every crash
  boundary reproduced except one (OB-0017, OB-0018→OB-0021).
- **Exactly-once external effect** — the *target* actually ends up with
  exactly one persisted record for the business operation, regardless
  of retries, redeliveries, or races. **Not achieved** by any mechanism
  this project has built or found, for this target, in this
  environment (OB-0022, OB-0023). Conflating this with "exactly-once
  processing" is the specific mistake this investigation was designed
  to avoid making.

## Decision

Adopt a **two-tier reliability contract** for how the Golden Path
handles non-transactional external side effects. The tier boundary is
drawn exactly where the evidence draws it: what has been demonstrated
to work without target cooperation, versus what would require target
cooperation this project has not yet proven exists.

### Tier 1 — Baseline guarantee (every Golden Path integration, any target)

**Recoverable at-least-once processing, with narrowed and monitored
duplicate/loss windows. Not exactly-once external effects.**

Concretely, this is Option C below: integration-owned atomic durable
ownership (`acquire`), crash recovery via reclaim + target
reconciliation (closing both reproduced sequential crash boundaries,
OB-0021), **mandatorily paired with** audit/reconciliation-based
detection of residual `GAP` and `DUPLICATE` states, using the
already-validated pattern from `detect-unprocessed-events.ts`
(OB-0012). A target only needs to expose a queryable business-operation
identifier for Tier 1 - no special target capability is required.

This is the floor for every integration this project builds, because
it is the only option that is both (a) fully evidenced and (b) honest
about what it does not guarantee. It does not claim exactly-once
external effects - the slow-owner race remains a real, if rare,
possibility (OB-0022) - but it never lets that failure go silent.

### Tier 2 — Enforced guarantee (opt-in, per target, earned not assumed)

**Exactly-once external effects, only for a target proven - by direct
experiment, not documentation - to provide an atomic conditional-create
or equivalent enforcement mechanism.**

This is Option A below. For ServiceNow, as configured in this
development instance, **Tier 2 has not been earned**: the schema-level
unique-index path is either blocked by platform design or unexplained
(FL-0018, OB-0019), and no client-reachable API provides target-side
write enforcement (OB-0023). The one remaining, unproven avenue - a
custom ServiceNow Business Rule or Scripted REST API performing the
existence-check-and-insert inside a single ServiceNow transaction - has
not been attempted. It would need the same evidentiary rigor as
everything above (built, tested under real concurrency, independently
verified) before this integration could claim Tier 2, and it is a
materially larger commitment than anything built so far: platform
development on the target itself, not this repository.

Other future Golden Path targets are not assumed to share ServiceNow's
limitations. Each target should be evaluated for Tier 2 eligibility on
its own evidence before being marketed as providing a stronger
guarantee - that evaluation is part of what "onboarding a new target"
means under this contract, not a one-time platform decision.

## Alternatives considered

### A. Target participates in idempotency/enforcement

| | |
|---|---|
| **Guarantee provided** | Exactly-once external effect, robustly - the atomic decision happens inside the same transaction that produces the side effect. The strongest guarantee possible, if achievable. |
| **Guarantee not provided** | None, if achieved. Currently: none, because it hasn't been achieved. |
| **Required target capabilities** | A target-side atomic conditional-create or unique-constraint mechanism. **Tested and found absent/unproven:** schema-level `sys_index` unique constraint (FL-0018, OB-0016, OB-0019 - one path blocked by platform ACL design, the supported path unexplained); Table API HTTP conditional-write (`If-None-Match`/`ETag`) - confirmed absent by documentation and direct test (OB-0023); Import Set + Transform Map coalesce - confirmed non-atomic by corroborating evidence (OB-0023). **Not tested, not built:** custom ServiceNow server-side code (a Business Rule or Scripted REST API executing the check-and-insert inside one ServiceNow transaction). Genuinely unproven, not disproven. |
| **Integration/platform complexity** | High, if pursuing the one remaining avenue - ServiceNow platform development (update sets, a new skill area, code living on the target instead of this repository). Effectively unavailable via any of the built-in mechanisms actually tested. |
| **Operational consequences** | If achieved: minimal - the target owns the invariant, this integration doesn't need durable state at all for this specific concern. Today: none achieved, so claiming this guarantee today would be false. |
| **Developer experience consequences** | If achieved: simplest possible mental model ("just call the API, duplicates are impossible"). Today: no such simplicity exists, and pretending otherwise would be the exact overclaim this investigation exists to prevent. |
| **Evidence** | Supporting (in principle): none specific to this instance - the idea is sound in general REST-API design, just not demonstrated here. Contradicting (for what's been tried): FL-0018, OB-0016, OB-0019, OB-0023 - every reachable mechanism checked is absent or unproven. |

### B. Integration-owned reliability with reconciliation (no detection layer)

| | |
|---|---|
| **Guarantee provided** | At-least-once processing with the two reproduced sequential crash boundaries closed (crash-before-side-effect, crash-after-side-effect-before-completion - OB-0021) and concurrent processing/reclaim deduplicated (OB-0017, OB-0021 Case 3). |
| **Guarantee not provided** | Exactly-once external effect. The slow-owner race (OB-0022) produces a real duplicate, deterministically, under realistic conditions (a worker that is merely slow, not dead) - **this option cannot claim exactly-once external side effects**, and as scoped here, has no mechanism to even notice when that happens: the local record silently ends up wrong (OB-0022's sharper finding). |
| **Required target capabilities** | None beyond a queryable business-operation identifier - fully integration-owned. |
| **Integration/platform complexity** | Moderate: real durable storage (the current prototype is a throwaway SQLite file - a production choice of datastore is a separate, deferred decision), a staleness/reclaim policy, reconciliation logic. All within this project's own control. |
| **Operational consequences** | A residual, unmonitored duplicate risk. If the slow-owner race fires in production, nothing surfaces it - it contradicts this project's own standing principle (`CLAUDE.md`: never hide failures merely to make a demo pass) to build a mechanism with a known silent-failure mode and no detection. |
| **Developer experience consequences** | Attractive simplicity (one mechanism, no separate audit process to run) - but that simplicity is exactly what makes it dangerous to describe as "reliable" without the caveat, and this project has already seen how easily "seems fine" claims get corrected by direct testing (OB-0020, OB-0022). |
| **Evidence** | Supporting the parts that work: OB-0017, OB-0018, OB-0020, OB-0021 (direct, verified). Contradicting the "exactly-once" framing specifically: OB-0022 (direct, deterministic counter-example, not a theoretical gap). |

### C. Integration-owned reliability plus detection/reconciliation of residual anomalies

| | |
|---|---|
| **Guarantee provided** | Everything in B, plus: any residual `GAP` or `DUPLICATE` - including the slow-owner race B cannot prevent - becomes **detectable**, not silent, using the already-validated audit mechanism. |
| **Guarantee not provided** | Still not exactly-once external effect - prevention doesn't reach 100%. The improvement is that failure becomes observable and correctable after the fact, rather than invisible. |
| **Required target capabilities** | Same as B - only a queryable business-operation identifier. No new target capability. |
| **Integration/platform complexity** | B's complexity, plus a genuinely small increment: `scripts/detect-unprocessed-events.ts` already classifies `GAP`/`OK`/`DUPLICATE`/`UNEVALUABLE` and was validated with **zero discrepancies** against this project's complete known history, including correctly finding a real duplicate and a real silent loss (OB-0012). The detection half of this option is not a new mechanism to build - it is an existing one to schedule and act on. |
| **Operational consequences** | Requires an actual commitment to run the audit regularly (currently on-demand only - LL-0011's still-open "not automatic" gap) and a defined response process for a discovered `DUPLICATE` (e.g. manually closing/merging the extra Incident). New operational surface, but it bounds the *dwell time* of a residual failure instead of leaving it unbounded. |
| **Developer experience consequences** | The most honest story available: "the Golden Path guarantees recoverable at-least-once processing, and gives you a validated tool to find and fix the rare cases where the target ends up with a gap or a duplicate" - sets correct expectations instead of an overclaim that later testing (the exact pattern this whole investigation followed) would eventually disprove. |
| **Evidence** | OB-0012 (detection validated, zero discrepancies), OB-0017/OB-0018/OB-0020/OB-0021 (prevention narrows the windows detection has to cover), OB-0022 (the specific, concrete reason detection remains necessary even with the best prevention mechanism built so far). |

### D. Hybrid: tiered contract (the decision made above)

| | |
|---|---|
| **Guarantee provided** | Tier 1 (= Option C) unconditionally; Tier 2 (= Option A) only for a target proven to support it. |
| **Guarantee not provided** | Tier 2's exactly-once external effect, for any target that hasn't earned it - which today means every target this project has, including ServiceNow. |
| **Required target capabilities** | Tier 1: none. Tier 2: proven per-target, not assumed. |
| **Integration/platform complexity** | Tier 1's complexity is mandatory and already evidenced. Tier 2's complexity is real but deferred - not paid for targets that don't need or can't get it. |
| **Operational consequences** | Same as C for every integration today; a defined, evidence-gated path to upgrade specific integrations later without re-architecting the baseline. |
| **Developer experience consequences** | A Golden Path developer gets one consistent baseline promise regardless of target, and a clear, honest answer to "can this be stronger" - test it the way this project tested ServiceNow, don't assume it. |
| **Evidence** | Not chosen for being conventional - chosen because the evidence itself has two different evidentiary statuses (proven-and-working vs. unproven-and-uninvestigated) that a single-tier answer would have to either overclaim or discard. The tiering is a direct reflection of what OB-0014 through OB-0023 actually established, not a design preference layered on top of it. |

## Consequences

- The Golden Vine Salesforce → ServiceNow integration, once this
  decision is implemented (nothing has been implemented as part of
  this ADR), operates at **Tier 1 only**. It does not, and must not,
  claim exactly-once external effects in any documentation, demo
  narrative, or future case-study writeup.
- The residual slow-owner-race risk (OB-0022) is bounded by detection,
  not eliminated. Its probability is a function of the reclaim
  staleness threshold versus real ServiceNow call latency - an
  operational tuning knob, not a solved problem, and worth stating as
  such rather than implying the risk is negligible.
- Tier 1's detection half is currently a validated *instrument*, not a
  *monitored system* (LL-0011's distinction, still open) - the "next
  step" below addresses turning it into one, since an unscheduled audit
  tool doesn't bound dwell time in practice, only in principle.
- Tier 2 remains a real, named option for ServiceNow specifically (via
  custom server-side development) and for future targets generally -
  not rejected, deferred pending evidence this project doesn't yet
  have.
- Any future Golden Path target must be evaluated for Tier 2 using the
  same evidentiary bar set here (real, adversarial experiments; not
  documentation, not assumption) before being marketed as providing a
  stronger guarantee than Tier 1.
- This ADR does not choose *which* durable-storage technology, retry
  policy, or specific staleness threshold a real Tier 1 implementation
  should use - those remain implementation details for the next phase,
  consistent with this project's practice of not manufacturing detail
  ahead of the decision that requires it.

## Next step (Enablement phase — not implemented here)

The first Enablement-phase implementation that follows directly from
this decision is to **promote the already-validated Tier 1 mechanisms
from experimental scripts into the real, running integration service**,
rather than build anything new:

1. Wire `idempotencyStore.ts`'s atomic ownership, reclaim, and target
   reconciliation (`acquire`/`reclaim`/reconciliation, as proven in
   OB-0017/OB-0021) into `src/salesforce/pubsubClient.ts` and
   `src/servicenow/incidentAdapter.ts`'s actual processing path,
   replacing the current no-idempotency default.
2. Turn `scripts/detect-unprocessed-events.ts` from an on-demand
   experimental tool into an actually-scheduled reconciliation job,
   closing LL-0011's "validated instrument, not a monitored system" gap
   - the specific piece that makes Tier 1's detection promise real
   rather than theoretical.

This is deliberately the smallest real step: every mechanism it wires
in has already been independently verified by experiment (OB-0012,
OB-0017, OB-0021); nothing new is being designed or trusted for the
first time. The separate, larger, and explicitly *not* recommended-yet
step is any Tier 2 investigation (custom ServiceNow server-side
development) - that remains a distinct future decision, to be made only
if a specific integration's requirements justify the added platform
commitment.
