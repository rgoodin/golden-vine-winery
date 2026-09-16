# 0006. Tier 1 recovery-payload sourcing

**Status:** Decided (architecture only — not implemented; see "Next
step" below).
**Supersedes:** nothing. Extends ADR 0005, which decided the
reliability *guarantee* Tier 1 provides but did not address where a
Tier 1 recovery caller obtains the business payload it needs to act.
**Built on:** `docs/devex/observations.md` OB-0026 (the production
recovery mechanism this ADR assumes exists and is unmodified by this
decision) and OB-0027 (the investigation this ADR formalizes). This
document records the decision; OB-0027 has the full experimental
detail and is cited, not repeated.

## Context

### The question

`recoverStaleDistributorOnboardingOperation()` (OB-0026) reclaims a
stale `in_flight` business operation and, if ServiceNow reconciliation
finds nothing, must create the Incident — which requires the full
original event (distributor, contact, sales fields), not just the
business-operation ID. `src/reliability/idempotencyStore.ts`
deliberately stores neither (FL-0024). **Where should that payload come
from?**

### Facts established experimentally (OB-0027), not assumed

- A business-operation ID can be relocated in this environment by
  consuming Salesforce's retained event history with
  `ReplayPreset.EARLIEST` and matching on business-operation identity
  (`Correlation_Id__c`). The observed experiment scanned 14 retained
  events and took approximately 8.6 seconds to locate the one match.
- The Salesforce Pub/Sub `FetchRequest` message available to this
  project provides no server-side query-by-business-field mechanism —
  confirmed by direct inspection of `pubsub_api.proto`, not inferred
  from the SDK's convenience surface. `topic_name` / `replay_preset` /
  `replay_id` / `num_requested` are its only fields, across every RPC
  the API exposes.
- Using an event's own replay ID with `ReplayPreset.CUSTOM` resumes
  **after** that event, not at it — confirmed by direct test (publish
  A then B, replay from A's own replay ID, only B comes back), not
  merely from the proto's documentation comment.
- **Therefore an event's own replay ID is not, by itself, a
  random-access retrieval key for that event.** A reference sufficient
  to refetch a specific event would need to be the position preceding
  it — something no part of this codebase captures per-operation today
  (`checkpoint.ts` tracks one global last-processed position for the
  whole stream, overwritten on every event).
- The actual Salesforce replay-retention horizon available to this
  project remains unestablished. `GetTopic`'s `TopicInfo` exposes no
  retention field (FL-0013); this ADR does not claim a retention window
  it has not measured.

## Decision

**Approach A — source-owned recovery payload.** Tier 1 recovery
continues to source the business payload it needs by locating the
business operation's original event from Salesforce's retained replay
history at recovery time (matching on business-operation identity, the
mechanism `detect-unprocessed-events.ts` already uses and OB-0027
confirmed works). The reliability store persists no business payload
and no Salesforce-specific position reference. This matches what
`recoverStaleDistributorOnboardingOperation()` already does today
(OB-0026) — this ADR ratifies that design rather than changing it.

### What this decision does not guarantee

This is a decision to depend on Salesforce's replay history, not a
claim about that history's durability. Specifically, this decision:

- **Does not** claim permanent payload durability. Nothing durable and
  under this integration's control guarantees the source event remains
  available.
- **Does not** claim random-access retrieval of a Salesforce event.
  Locating one event means scanning retained history and matching on
  business-operation identity — there is no cheaper path with the APIs
  this project has access to (see Facts above).
- **Is** conditioned on the required event still being present in
  replayable source history at the moment recovery runs. If Salesforce
  has aged it out, recovery cannot proceed via this mechanism, and this
  project has not established what that retention horizon actually is.

### When the source event cannot be located

This ADR does not invent a new recovery mechanism to handle this case.
At minimum: **an operation whose source event cannot be located during
recovery must remain an observable, unresolved `GAP` requiring
operational attention.** It must not be silently treated as recovered
or completed, and no fallback (partial Incident, placeholder record, or
similar) is introduced by this decision. This is a direct restatement
of ADR 0005's Tier 1 promise — recoverable at-least-once processing,
paired with detection of what cannot be prevented — applied to this
specific failure mode rather than an exception to it. The existing
`detect-unprocessed-events.ts` classification (`GAP`) already expresses
this state; nothing new needs to be built for it to remain visible.

### Architectural separation preserved

This decision does not add Salesforce-specific knowledge to the
generic reliability store, and does not blur the boundary a recovery
caller already crosses:

    reliability store        owns processing state / business-operation ownership
    source adapter            owns locating/reconstructing source business events
    target adapter             owns reconciliation with the external target

`src/reliability/idempotencyStore.ts` remains ignorant of Salesforce,
replay IDs, and event payloads — unchanged by this ADR (DP-0003,
DP-0007, DP-0011). Locating the source event is a **source-adapter**
responsibility (today: ad hoc, via `pubsubClient.ts`'s `replayRange()`,
called by whatever invokes recovery — see "Next step"); reconciling
against ServiceNow remains a target-adapter responsibility
(`src/servicenow/incidentReconciliation.ts`, unchanged). This ADR is,
among other things, a decision *not* to let recovery-payload sourcing
erode that separation by pulling payload storage into the reliability
store (Approach B) or Salesforce replay-position semantics into it
(Approach C).

## Alternatives considered

### B. Integration-owned recovery payload

| | |
|---|---|
| **Description** | Persist sufficient business payload alongside the durable operation at initial acquisition, so recovery does not depend on Salesforce replay at all. |
| **Recoverability** | Strongest — fully self-contained, no dependency on source retention. |
| **Dependence on source replay/retention** | None. |
| **Lookup cost** | O(1) — same `PRIMARY KEY` lookup already used for acquire/complete/reclaim. |
| **Payload/schema evolution** | New, real cost: a stored payload must be versioned as `DistributorOnboardingRequestedEvent` evolves (`CLAUDE.md` already expects this schema to change). Recovery could replay an old stored shape against newer target-adapter code with no established handling for the mismatch. |
| **Storage responsibility** | New: the reliability store (or a sibling abstraction) durably duplicates business data Salesforce already owns as source of truth — two copies, no established reconciliation between them if they diverge. |
| **Coupling** | Erodes the boundary above: the reliability layer would need to know what "the payload" means, most likely per business-event-type, undermining the target/source-agnostic design confirmed twice already (DP-0003, DP-0007). |
| **Developer complexity** | Simple at recovery time; new decisions and code required at acquisition time (what to store, how to version it, where it lives). |
| **Why not chosen now** | Solves a problem — recovery unavailability under retention pressure — this project has not yet observed as real (14 events, ~2 months in). Per `CLAUDE.md`'s Core Principle, not the smallest useful change today. Revisit if the circumstances in "When to revisit" below occur. |

### C. Minimal durable source reference

| | |
|---|---|
| **Description** | Persist a small Salesforce position/reference (e.g. a replay ID) alongside the durable operation, and use it to retrieve the corresponding event later instead of a full sweep. |
| **Recoverability** | Not achieved by the naive version tested (an event's own replay ID) — confirmed unusable for this purpose (OB-0027 Part 2). A correct version would need the *preceding* position, not built. |
| **Dependence on source replay/retention** | Same as Approach A — still fundamentally sourced from Salesforce; only the starting point would be cheaper, not the dependency itself. |
| **Lookup cost** | Would be cheaper than Approach A's full sweep *if* a correct reference existed — bounded to a small window from the preceding position rather than all retained history. Not available today. |
| **Payload/schema evolution** | None — no payload stored, same benefit as Approach A. |
| **Storage responsibility** | Small new column in principle, but capturing the *right* value (the position preceding each operation, not the operation's own) requires new per-operation plumbing this codebase does not have — `checkpoint.ts` tracks one global position for the whole stream, not one per business operation. |
| **Coupling** | Erodes the boundary above differently: a replay-ID reference bakes a Salesforce-specific addressing concept into the generic reliability store, something Approach A's "just an ID and status" avoids entirely. |
| **Developer complexity** | Looked minimal before investigation; confirmed by direct experiment to require real new plumbing (capturing a preceding position, not an event's own) that does not exist anywhere in this codebase yet. |
| **Why not chosen now** | The evidence obtained specifically to evaluate this option (OB-0027 Part 2) shows the obvious implementation does not work, and the correct implementation is a larger, more invasive change than "persist one more field" for a benefit (cheaper lookup, same retention dependency) that doesn't address the actual risk (event no longer retained) at all. |

## Consequences

- Recovery remains dependent on Salesforce's replay history being
  available at the time recovery runs. This project has not
  established that history's actual retention horizon (FL-0013) and
  this ADR does not manufacture that fact.
- Locating a specific stale operation's source event costs a full
  `ReplayPreset.EARLIEST` sweep today (no server-side query-by-field
  mechanism exists) — 14 events, ~8.6 seconds, at the time of
  measurement. This cost grows with total accumulated topic history,
  not with how recent the operation is, and is unbounded as the
  project's event history grows.
- There is no direct (O(1) or targeted) lookup by business-operation ID
  against Salesforce — only a scan-and-match, using tooling
  (`replayRange()`) already built and validated for this purpose
  (`detect-unprocessed-events.ts`).
- Recovery latency includes this scan cost, in addition to the
  reconciliation call to ServiceNow already required by OB-0026's
  mechanism.
- No additional business payload is persisted anywhere in this
  integration as a result of this decision. Salesforce remains the sole
  durable owner of business-event data.
- No new payload schema or version lifecycle is introduced in
  `src/reliability/idempotencyStore.ts`, or anywhere else in the
  reliability layer.
- The architectural separation between reliability store, source
  adapter, and target adapter (see above) is preserved exactly as it
  stood after OB-0026 — this decision required no change to any of the
  three.

## When to revisit this ADR

This decision should be revisited, not silently worked around, if any
of the following becomes true:

- **Evidence that Salesforce's replay retention is insufficient for the
  required recovery window** — e.g. a real operation becomes
  unrecoverable because its source event aged out before recovery ran.
  This ADR explicitly does not know today whether or when that could
  happen.
- **Evidence that the scan cost has become operationally unacceptable**
  — e.g. recovery latency or Pub/Sub load measurably degrades as topic
  history grows, rather than the currently-observed 14-event, ~8.6s
  cost.
- **A new source capability becomes available that provides durable,
  direct (non-scan) event retrieval** — e.g. a Salesforce API that
  supports lookup by a business field or a stored custom identifier,
  which would change the cost/complexity comparison against Approach C
  materially.

Any of these would be new evidence, not a change of opinion, and should
be investigated with the same discipline as OB-0027 before this
decision is changed.

## Next step (Enablement phase — not implemented here)

The smallest implementation step that follows directly from this
decision is **connecting `detect-unprocessed-events.ts`'s existing
`GAP` classification to a recovery invocation**, under this ADR's
payload-source contract:

1. When the audit tool classifies a business operation as `GAP`, it
   already has that operation's full source event in hand (it read it
   to classify it) — pass that same event, in the same run, to
   `recoverStaleDistributorOnboardingOperation()` rather than
   discarding it and requiring a second, separate lookup.
2. Keep this manually triggered (via the existing on-demand audit run)
   for the first version — do not build a scheduler or automatic
   trigger in the same step. That remains a distinct, larger
   Enablement decision (already named as not-yet-built in `CLAUDE.md`),
   deliberately separated so this step stays small and independently
   verifiable.
3. If a `GAP`'s operation cannot be reclaimed (e.g. it was never
   `acquired` locally in the first place — a different, currently
   unaddressed shape than the reclaim-based recovery this ADR and
   OB-0026 cover), that must surface as a distinct, still-unresolved
   case rather than being absorbed into this step silently. Scoping
   that shape is future work, not part of this step.

This is deliberately the smallest real step: it reuses the exact
production recovery function verified in OB-0026, under the exact
payload-sourcing contract decided here, without introducing a
scheduler, a new mechanism, or a new abstraction.
