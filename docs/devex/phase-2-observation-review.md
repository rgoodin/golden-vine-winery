# Phase 2 Observation Review

**Status:** Complete. This is the authoritative checkpoint for the
conclusions reached in this review.

**What this document is:** a **human-led** review of the accumulated
developer experience recorded in `docs/devex/observations.md`,
`docs/devex/friction-log.md`, `docs/devex/lessons-learned.md`, the
architecture spike, and ADRs 0001–0007. It sits at the point in the
DevEx Dojo cycle between raw developer experience and an Enablement
decision — see CLAUDE.md's "Human-Led DevEx Observation Review"
section for how that step now fits into the cycle generally.

**What this document is not:** it is not a replacement for, or a
rewrite of, the contemporaneous "Phase 2 (Observation Review)" cycles
already referenced in `docs/devex/lessons-learned.md` (LL-0001 onward)
and summarized in `CLAUDE.md`'s "Current Repository State." Those were
real, in-the-moment reviews conducted as Developer #1 implementation
work was happening. This document is a later, higher-order review,
conducted once implementation had produced enough material to reason
about the *shape* of a Golden Path, not just the next experiment.

**Important:** the findings below are **human-reviewed conclusions**,
reached in direct conversation with the project's owner. They are not
Claude-generated deductions summarized from the logs after the fact.
Claude's role in producing this document was to record and structure
conclusions that were already reached, and to cite the existing
evidence that supports them — not to originate the findings themselves.
Where a finding reinterprets or narrows something Developer #1
concluded earlier (most notably ADR 0005's terminology), the earlier
document is preserved unmodified as historical evidence — see Finding
12 and `docs/decisions/0005-external-side-effect-reliability-contract.md`'s
own cross-reference note.

---

## Finding 1 — Salesforce initial configuration creates premature decisions

Developer #1 encountered Salesforce configuration choices (External
Client App settings, OAuth scopes, flow enablement, permitted-users
policy — `docs/runbooks/salesforce-non-interactive-auth-setup.md`)
before having enough experience to understand their consequences.
Potential future enablement should convert low-level configuration
choices into intent-oriented starting points, such as:

- minimal / hello-world
- platform-to-platform integration
- broad / full configuration

**This friction was not captured by the original logs.** That absence
is itself evidence that the observation mechanism, as originally
scoped, can miss meaningful friction — specifically, friction that
happens *before* the developer starts writing integration code. See
Finding 14 and the "Record friction before coding starts" addition to
CLAUDE.md's Developer Experience Journal section.

## Finding 2 — Separate irreducible human participation from accidental technical complexity

Salesforce's observed email identity-verification step
(`docs/runbooks/salesforce-non-interactive-auth-setup.md` step 5)
requires genuine human participation and should be clearly explained
as such, not treated as friction to eliminate. Separately, developers
should not have to make JWT / gRPC / authentication *architecture*
decisions merely because the underlying transport happens to require
them — that is accidental complexity, not an irreducible human step,
and belongs to Platform (see Finding 3).

## Finding 3 — Shared transport complexity is a platform concern

Developers should primarily consume the business event, not the
transport that delivers it. Salesforce Pub/Sub API mechanics — gRPC,
protobuf/Avro schema resolution, replay, checkpoint — belong to the
platform for the supported integration pattern
(`src/salesforce/pubsubClient.ts`, `checkpoint.ts` — already identified
as reusable-capability candidates in
`docs/golden-path/0001-enablement-inventory.md` category B).

Developers can challenge this abstraction. A legitimate new
requirement that the current transport abstraction can't satisfy
should feed back into Platform/Dojo review (see Finding 10), not
produce a silent workaround that bypasses the abstraction without
anyone else learning why.

## Finding 4 — Integration mechanism selection initially belongs at platform level

Developers define the business need. Platform selects and supports the
integration mechanism for that class of integration (e.g. Pub/Sub API
for Salesforce event delivery), to avoid unnecessary proliferation of
competing mechanisms solving the same problem differently across
integrations. Developers are encouraged to challenge that choice with
evidence — a demonstrated case where the supported mechanism doesn't
fit — rather than silently picking a different one.

## Finding 5 — ServiceNow platform configuration initially remains Platform/ServiceNow-team owned

Machine identities, OAuth configuration, roles/ACLs, auth scopes, and
credential setup (`docs/runbooks/servicenow-non-interactive-auth-setup.md`)
should not become developer self-service merely because automation is
technically possible. This is already reflected in how the runbook is
written — "a checklist, not automation," with the system-property
change in step 2 called out as a deliberate, reviewed action each time.
Additional implementations should provide evidence (repeated real
friction, not a hypothetical) before self-service capability is built
here.

## Finding 6 — Canonical contract ownership begins centrally but may evolve

Platform initially coordinates the canonical event contract (currently
`DistributorOnboardingRequestedEvent`,
`docs/decisions/0003-platform-event-schema.md`) with heavy business and
development input — not unilaterally. Repeated implementations across
more integrations may reveal a better domain-owned or federated
ownership boundary than central coordination. Central ownership is a
starting point justified by the evidence available today (one
integration, one contract) — it is explicitly **not** assumed
permanent, and `docs/golden-path/0001-enablement-inventory.md`'s
Unresolved section already flags the base-event-type question as open
for exactly this reason.

## Finding 7 — Golden Path reliability experiments should remain visible

Developer #2 should be able to run and observe the experiments that
established the current reliability behavior — duplicate delivery,
crash boundaries, replay/checkpoint ordering, idempotency, concurrent
reclaim, and recovery
(`scripts/test-production-concurrent-idempotency.ts`,
`scripts/test-production-recovery.ts`,
`scripts/lib/slowWorkerA.ts`/`slowWorkerB.ts`, and the rest of
`docs/golden-path/0001-enablement-inventory.md` category D) — not just
be told the guarantee holds.

The Golden Path's job is to reduce reinvention. The Dojo's job is to
prevent the resulting abstraction from hiding the evidence that
justified it. Developers are encouraged to investigate additional edge
cases beyond the ones already tested and feed the resulting
observations back into the Dojo (see Finding 10).

## Finding 8 — Business/development defines business-operation identity

Platform must not decide what constitutes a duplicate business
operation. Business/development defines whether two technical events
represent one intended operation or two legitimate, separate
operations — evidenced concretely by `correlationId`'s role in
`src/processDistributorOnboardingEvent.ts` and the duplicate definition
in `src/servicenow/incidentReconciliation.ts` /
`scripts/detect-unprocessed-events.ts`, already flagged as a
business-owned decision in
`docs/golden-path/0001-enablement-inventory.md`'s cross-cutting threads.
Platform carries that identity through the system and implements
defensive mechanisms, logging, and alerting around it — it does not
originate the identity's meaning.

## Finding 9 — The Golden Path does not guarantee the destination

Preserve the phrase:

> **It's a Golden Path, not a gold watch.**

The Golden Path provides evidence-backed implementation, known
behavior, runnable experiments, documented limitations, and guardrails.
It does not, by itself, guarantee that those observed characteristics
satisfy a given customer's requirements in that developer's actual
architecture. The consuming developer determines that fit — the Golden
Path gives them the evidence to determine it with, rather than asking
them to trust it blindly or rebuild the evidence themselves.

## Finding 10 — Golden Path adoption is encouraged, not compulsory

Developers may conclude, with evidence, that the Golden Path is
insufficient for their situation. They should be strongly encouraged to
bring that evidence back to Platform/Dojo *before* independently
abandoning the path, whenever practical. That evidence may result in:

- Platform improving the Golden Path, or
- the Dojo working with the developer on a customer-specific
  implementation and feeding the resulting observations back into
  Platform for the next iteration.

A justified exception is itself a valuable Observation, not a
compliance failure — see CLAUDE.md's "Golden Path Adoption" section.

## Finding 11 — Recovery risk belongs to the business/customer

Platform can measure latency, identify stale operations, reconcile
against a target, and provide evidence
(`src/recoverStaleDistributorOnboardingOperation.ts`,
`scripts/detect-unprocessed-events.ts`'s `--recover` mode,
`docs/decisions/0007-tier1-scheduled-recovery-operational-contract.md`).
It does not independently decide when the risk of retrying (a possible
duplicate, OB-0022) is preferable to the risk of waiting or missing an
operation. That is a business/customer risk decision. Platform
implements the chosen policy with detailed logging and alerting, it
does not set the policy itself — this reframes *why* ADR 0007 refused
to pick a `staleAfterMs` value: not only because the evidence didn't
exist yet, but because choosing that threshold unilaterally was never
Platform's decision to make in the first place.

## Finding 12 — Do not retain Tier 1/Tier 2 reliability terminology

Do not carry the "Tier 1"/"Tier 2" framing forward as the Golden Path's
general reliability model. Replace the concept with evidence-backed
reliability behavior/profiles, described this way:

> "Here is the reliability behavior this profile is designed to
> provide. Here are the experiments that established it. Run them
> against your implementation. Compare the observations with your
> customer's requirements. Do not claim a stronger property than your
> evidence supports."

**`docs/decisions/0005-external-side-effect-reliability-contract.md`
remains historical evidence of Developer #1's reasoning and is not
rewritten.** It correctly and accurately records the architectural
conclusion Developer #1 reached, using the terminology and reasoning
available at that point in the project. This finding does not make that
ADR wrong — it makes the *Tier 1/Tier 2 language* an artifact of that
specific round's implementation, not a durable Golden Path concept to
propagate forward. See ADR 0005's own cross-reference note, added as
part of this review, pointing back to this finding.

## Finding 13 — Developers consume operational evidence; Platform/Operations owns the machinery

Developers should run and understand audit results — `OK`, `GAP`,
`DUPLICATE`, `UNEVALUABLE`
(`scripts/detect-unprocessed-events.ts`) — as a normal part of
validating their integration. They should not need to maintain
scheduling, locking, SQLite queries, replay scanning, or reconciliation
orchestration (`scripts/ops/run-scheduled-audit.sh`,
`src/reliability/idempotencyStore.ts`'s internals) unless they are
specifically working on that capability. This is already reflected in
`docs/golden-path/0001-enablement-inventory.md`'s category C
(Platform/operations) vs. category D (teaching/verification) split.

## Finding 14 — No additional recalled friction was manufactured

When the human reviewer could not recall additional meaningful friction
beyond what the contemporaneous logs already captured, the review
returned to and worked from that existing evidence rather than
inventing new problems to retroactively justify Golden Path
capabilities. Finding 1 is the one confirmed exception — a real gap in
what the observation mechanism had captured, not a manufactured one, and
recorded as friction about the *mechanism itself* (see Finding 15's
sibling addition to the Developer Experience Journal instructions).

## Finding 15 — Incomplete evidence remains visibly incomplete

> Absence of evidence is not evidence of absence.

Insufficient evidence should produce a visibly incomplete state —
`UNEVALUABLE` (`scripts/detect-unprocessed-events.ts`), an unhealthy
run status (`checkSweepHealth()`, ADR 0007 §4, FL-0026), logging, and
alerting. It must never silently become a success result, and it must
never authorize a mutating recovery action on its own. Retries or
re-runs must not erase evidence that an earlier observation attempt
failed — the failure itself is data.

---

## What this review did not do

- It did not implement any Golden Path capability. It reviewed and
  classified existing evidence.
- It did not convert `docs/golden-path/0001-enablement-inventory.md`'s
  candidates into an approved backlog. That inventory remains analysis
  input to future Enablement decisions, not a decision itself.
- It did not rewrite ADR 0005 or any other historical record. See
  Finding 12.
- It did not choose a `staleAfterMs` value, a recovery cadence, or any
  other business/customer risk policy. See Finding 11.

## Next step

Per the checkpoint instruction that produced this document: none. This
is a documentation checkpoint. The next Enablement decision — if any —
is a separate, later step requiring its own explicit approval.
