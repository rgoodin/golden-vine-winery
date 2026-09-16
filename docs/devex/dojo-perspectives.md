# DevEx Dojo Perspectives

`CLAUDE.md`'s "DevEx Dojo Roles" section defines four lenses this
project should eventually be examined through - Developer, Dojo
Instructor, Platform Engineer, Dojo Director. This log records entries
from each lens when a specific piece of work produces something
genuinely worth saying from that perspective - not a ritual update
after every change. See `docs/devex/observations.md`,
`docs/devex/friction-log.md`, and `docs/devex/lessons-learned.md` for
the underlying evidence each entry here draws on.

---

## Template

### DP-XXXX: <short title>

**Date:** YYYY-MM-DD
**Phase:** <current DevEx Dojo phase>
**Perspective:** Developer | Dojo Instructor | Platform Engineer | Dojo Director

<What this perspective specifically notices, and why it matters from
that vantage point - not a restatement of the underlying OB/FL/LL
entry.>

---

## Entries

### DP-0001: Wiring a validated experiment into production was small - once the experiment existed

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)
**Perspective:** Developer

Implementing ADR 0005's Tier 1 baseline in the real service
(`src/reliability/idempotencyStore.ts`, `src/processDistributorOnboardingEvent.ts`,
OB-0025) took two new files and a three-line change to `src/index.ts`.
`src/salesforce/pubsubClient.ts` and `checkpoint.ts` - the two files a
developer might reasonably have expected to need changes - didn't need
any. That's not luck: it's the payoff of everything upstream of this
round (OB-0014 through OB-0023) already having answered the hard
questions (what to key on, where the atomic decision has to live, what
"checkpoint as appropriate" actually means) before any production code
was written. The one place a developer still has to think, not just
copy, is FL-0023's question - what happens to the checkpoint when the
gate correctly says no - because that's a mechanical detail the ADR's
diagram implies but doesn't spell out.

### DP-0002: The delivery-identity/business-operation-identity distinction has to be visible in the code, not just documented

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)
**Perspective:** Dojo Instructor

ADR 0005 and this round's task both explicitly warned against using
`eventId` as a stand-in for `correlationId` "merely because it's
convenient." That's exactly the kind of rule a developer under time
pressure will violate without noticing, because both are just strings
sitting next to each other on the same object. The mitigation isn't
more prose - it's naming: `processDistributorOnboardingEvent`'s log
lines and `ProcessResult` always say `businessOperationId`, never a
generic `id`, and `eventId` only ever appears in messages explicitly
labeled "Salesforce event ID for this delivery." A future Golden Path
template teaching this pattern should treat that naming discipline as
part of the lesson, not an afterthought - the distinction has to survive
contact with a developer skimming the code, not just a developer
reading the ADR once.

### DP-0003: `idempotencyStore.ts` is a real platform-capability candidate - not yet, because there's still only one consumer

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)
**Perspective:** Platform Engineer

`src/reliability/idempotencyStore.ts` is now genuinely reusable - the
API (`acquireOperation`/`completeOperation`/`getOperation`) has nothing
Distributor-onboarding-specific or Incident-specific about it. It is
*not* extracted into a shared package this round, consistent with this
project's already-established pattern (`scripts/lib/salesforceTooling.ts`):
premature until a second integration or a second business operation
inside this same service actually needs it. What a Platform Engineer
should watch for is the trigger condition, not preemptively build for
it. Separately, and more urgently: FL-0022's finding (`checkpoint.ts`
assumes exactly one running instance) is a real platform gap that would
block reusing this exact pattern safely in a horizontally-scaled
integration - worth tracking as a known limitation of the pattern as it
stands today, not something to fix speculatively before any integration
actually needs to scale out.

### DP-0004: This is the first time the project has completed a full Observation → Enablement loop

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)
**Perspective:** Dojo Director

Every prior reliability round (OB-0014 through OB-0023) was
investigation - deliberately not implementing, per each round's own
instruction, right up through ADR 0005 itself. This round is the first
time that discipline paid off in the other direction: because nothing
was built speculatively, there was exactly one validated mechanism to
promote, and promoting it cost two small files and a handful of
verified-not-assumed test results (OB-0025). That is the DevEx Dojo
cycle `CLAUDE.md` describes working as designed, not just as an
aspiration - Observation produced evidence, the ADR converted evidence
into a decision, and Enablement moved only what the decision actually
required. The real test of whether this generalizes - not just for
this one integration, but as a *pattern* - is Phase 5's second consumer
(Salesforce → SharePoint): whether `idempotencyStore.ts`'s abstraction
holds up unchanged for a different target, or needs to change in ways
that reveal it was less general than it looked with only one consumer.
That question is open, not answered, and shouldn't be treated as
answered until a second integration actually exists.

---

<!-- Add new entries above this line, most recent first. -->
