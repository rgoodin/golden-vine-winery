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

### DP-0005: The durable store's "thinness" is a decision a developer has to actively learn, not something recovery's interface makes obvious

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1, stale-operation recovery)
**Perspective:** Developer

Implementing recovery surfaced something the first Enablement round's
scope didn't force into view: `idempotencyStore.ts` stores only an ID,
a status, and timestamps - never the event payload itself (FL-0024).
That's the right call (DP-0003 already flagged target-agnosticism as
the reason the store should stay generic), but it means
`recoverStaleDistributorOnboardingOperation()` can't be called with just
a business-operation ID the way a developer's first instinct would
expect - it needs the whole original event, sourced from somewhere else
entirely (Salesforce's own replay). A developer picking this up cold
would reasonably try `recover(businessOperationId)` first and be
surprised it isn't offered. The function signature (`event`, not `id`)
is the actual documentation of this constraint - but only if a
developer stops to ask why, rather than assuming it's an oversight to
route around.

### DP-0006: "Recovery exists now" does not mean "recovery happens now" - and that gap is easy to assume away

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1, stale-operation recovery)
**Perspective:** Dojo Instructor

FL-0025 is exactly the kind of assumption a developer - or, this round,
the implementer - makes silently and has to be walked back from: once
`recoverStaleDistributorOnboardingOperation()` exists and works
(OB-0026 proves it does, against real ServiceNow), it is tempting to
treat the recovery *problem* as solved. It isn't - nothing yet calls
that function for a real stuck operation; Salesforce's own natural
redelivery of the same event runs straight into the ordinary
"already-owned, do nothing" branch instead. The teaching point isn't
"build the scheduler" (explicitly out of scope) - it's that a developer
evaluating whether Tier 1 protects a given business operation needs to
ask two separate questions, not one: *can* this be recovered (yes, as
of this round), and *will* anything actually recover it (no, not yet).
Conflating those two is the exact mistake this round almost made before
writing FL-0025 down.

### DP-0007: The reliability/target boundary chosen last round held up under a second real extension, not just in principle

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1, stale-operation recovery)
**Perspective:** Platform Engineer

DP-0003 named `idempotencyStore.ts` as a platform-capability candidate
*because* its API had nothing ServiceNow-specific in it. This round is
the first real test of that claim: extending it only required adding
`reclaimOperation()` - itself just as target-agnostic as `acquire`/
`complete` - while everything ServiceNow-specific (querying by
`correlation_id`, deciding what "found" means) went into a brand-new
module, `src/servicenow/incidentReconciliation.ts`, that the generic
store never imports or knows about. That's a concrete signal, not just
an aspiration, that a second target's reconciliation would be its own
small module beside this one rather than a modification to it. The
`src/reliability/` vs `src/servicenow/` split is worth treating as the
actual pattern, not just this integration's file layout, once a second
target exists to prove it for real (Phase 5).

### DP-0008: Enablement's own friction just produced a new Observation - the cycle is already running its next lap, not a one-time loop

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1, stale-operation recovery)
**Perspective:** Dojo Director

DP-0004 framed the previous round as the project's first completed
Observation → Enablement lap. This round shows what happens next: FL-0025
(gap detection and gap recovery are two disconnected concerns) is not
something the architecture spike, ADR 0005, or last round's Enablement
work predicted - it only became visible by actually building recovery
and asking what triggers it. That is Enablement generating a fresh,
concrete Observation, exactly as `CLAUDE.md`'s cycle diagram claims it
should, without anyone deciding in advance to look for it. The
systemic takeaway isn't about this specific gap - it's that the cycle
doesn't need to be manually restarted between phases; implementing the
previous phase's decision is itself what surfaces the next one's
material, provided each round keeps writing that friction down instead
of quietly absorbing it into the next feature.

### DP-0009: A documented API semantic is a hypothesis until you've actually run it

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1) - recovery-payload investigation
**Perspective:** Developer

The "obvious" minimal fix for FL-0024 is Approach C: store the stale
operation's own replay ID, refetch it later. It reads as correct from
Salesforce's own proto comment ("start after"), and it would have been
easy to implement on that reading alone. Running it directly
(`scripts/test-recovery-payload-source.ts` Part 2) showed the reference
you'd naturally reach for - the event's own ID - specifically does not
work; you need the position *before* it, which nothing today captures.
The gap between "the docs say X" and "I ran it and confirmed X" is
exactly where a plausible-looking implementation would have shipped
silently broken. Worth treating as a default habit for this project
whenever a fix's design leans on a platform's documented-but-unverified
behavior, not just this one case.

### DP-0010: The cheap-looking answer to "where does this data live" is the one most likely to hide an architectural cost

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1) - recovery-payload investigation
**Perspective:** Dojo Instructor

Handed FL-0024 cold, a developer's fastest path is Approach B: just
save the event payload when you acquire the operation, recovery reads
it back, done. It looks like the obvious minimal fix - it is not. It
reopens a boundary two earlier rounds deliberately drew (DP-0003,
DP-0007: `idempotencyStore.ts` knows nothing about any target's or any
event's shape) and introduces a real, new problem this project hasn't
had to solve yet - versioning a durably-stored payload against a
canonical event schema `CLAUDE.md` already says is expected to change.
The teaching point isn't "Approach B is wrong" - OB-0027's comparison
doesn't rule it out forever - it's that "where should this data live"
questions deserve the same evidence-based comparison this round gave
them, specifically because the easiest-to-reach-for answer is often the
one with the most hidden, deferred cost.

### DP-0011: The recovery-payload question resolved without touching the reliability abstraction at all - that's the boundary paying for itself

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1) - recovery-payload investigation
**Perspective:** Platform Engineer

DP-0003 and DP-0007 both argued, from the inside, that keeping
`idempotencyStore.ts` ignorant of any target's or event's shape would
pay off later. This round is a real test from the outside: a genuinely
hard, evidence-requiring question (where should Tier 1 recovery get its
payload?) got investigated and resolved - recommend Approach A - without
a single line of `idempotencyStore.ts` changing. That's not a
coincidence of this particular question; it's what a correctly-drawn
boundary is supposed to produce: the module that shouldn't need to
change, for this kind of question, didn't have to. Worth watching
whether that continues to hold once Phase 5's second target exists, but
three rounds in, the boundary keeps being confirmed rather than
strained.

### DP-0012: Evidence and decision stayed separated again - the same discipline that produced ADR 0005, now at a smaller scale

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1) - recovery-payload investigation
**Perspective:** Dojo Director

It would have been easy, two Enablement rounds into a working Tier 1
implementation, to just pick Approach A and move on - the evidence
supports it, and nothing forced a pause. Instead this round did what
the reliability architecture spike did at a much larger scale: gathered
direct experimental evidence, laid out a real comparison instead of a
gut call, made a recommendation, and then explicitly separated "here is
what the evidence supports" from "here is the decision, formally
recorded" - proposing a small follow-up ADR rather than treating a
recommendation as a decision. That's the same discipline that produced
ADR 0005 in the first place, applied here to a question with a much
smaller blast radius. The systemic value isn't this specific
recommendation - it's evidence that the project's decision-making
discipline doesn't only show up for the big architectural forks; it's
holding at the scale of a single implementation detail, three rounds
into Enablement, without anyone having to re-invoke it deliberately.

### DP-0013: The ADR required no code change - it made an already-true contract explicit rather than triggering new work

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006)
**Perspective:** Developer

Writing ADR 0006 didn't change what `recoverStaleDistributorOnboardingOperation()`
does - it already sourced its payload from Salesforce replay, exactly
as the ADR now formally decides. What the ADR actually added for a
developer is the explicit contract around that existing behavior: what
it does and doesn't guarantee, and what must happen when it fails
(stays a `GAP`, never silently treated as recovered). Not every ADR
should be read as "now go implement this" - some, like this one, exist
to make a decision durable and citable that the code already embodies,
so the next developer touching this path doesn't have to reverse-engineer
the reasoning from OB-0027 or guess whether the current behavior was
deliberate.

### DP-0014: Writing down the failure fallback was the ADR's most load-bearing sentence, not the approach selection

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006)
**Perspective:** Dojo Instructor

Choosing Approach A was, by this point, the easy part - OB-0027's
evidence pointed at it clearly. The sentence that actually protects a
future developer is the one about what happens when the source event
can't be located: it must remain an observable `GAP`, never silently
treated as recovered or completed, with no invented fallback. That
constraint was true in spirit before this ADR (it follows directly from
ADR 0005's own promise), but it had never been stated as a rule
specific to this failure mode. Teaching a developer "here's the chosen
approach" is necessary but not sufficient - teaching them "here's the
one thing you must never do when it doesn't work" is what actually
prevents a plausible-looking shortcut (e.g., "just create an Incident
with placeholder data so the operation isn't stuck") from quietly
undermining ADR 0005 months from now.

### DP-0015: A named "when to revisit" section is a reusable ADR pattern, not just content specific to this decision

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006)
**Perspective:** Platform Engineer

ADR 0005 discusses risk and residual gaps in its Consequences section,
but doesn't name concrete, checkable conditions for when the decision
itself should be reopened. ADR 0006 does: retention proving
insufficient, scan cost becoming operationally unacceptable, or a new
Salesforce capability changing the cost comparison. That's a small
structural addition worth carrying into future ADRs generally, not just
this one - it turns "revisit this if circumstances change" from a vague
intention into something a future developer (or this project's own next
Observation round) can actually check against, rather than having to
independently notice the decision has gone stale.

### DP-0016: The project's ADR process just proved it scales down, not only up

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006)
**Perspective:** Dojo Director

ADR 0005 was a large decision - eight rounds of investigation, four
alternatives, a tiered contract. ADR 0006 is a small one - a single
implementation detail exposed by two Enablement rounds of real friction,
resolved in one bounded investigation. Both went through the same
discipline: evidence first, alternatives compared on the same
dimensions, a decision recorded with explicit non-guarantees, a next
step recommended but not taken. That a lightweight version of the same
process produced a genuinely useful, citable artifact for a much
smaller question is the real signal here - it means this project's
decision-making process isn't reserved for rare, big architectural
forks that justify the overhead. It's cheap enough to invoke whenever a
real fork appears, which is exactly what keeps a Golden Path's
decisions traceable instead of accumulating as implicit, undocumented
choices buried in code.

### DP-0017: Composing two validated components cost almost nothing in code - and the one real trap wasn't in either of them

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006's recommended next step)
**Perspective:** Developer

Wiring GAP detection to recovery touched two small things: exporting a
mapping function that already existed, and one new branch in a script
gated on an explicit flag. Neither `idempotencyStore.ts` nor
`recoverStaleDistributorOnboardingOperation.ts` changed at all. The
actual trap this round (FL-0026) wasn't in the composition's logic -
it was trusting a single "0 events" result from `replayRange()` at
face value, which briefly looked like confirmation of ADR 0006's exact
named risk (retention expiry) before a second run showed it wasn't. The
lesson isn't about this composition specifically - it's that the
riskiest moment in a round like this is often not the new code, it's
believing the first result a diagnostic tool gives you without
re-running it, especially right before that result becomes a documented
finding.

### DP-0018: Requiring an explicit value, not just an explicit flag, is what made the dangerous mode hard to trigger by accident

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006's recommended next step)
**Perspective:** Dojo Instructor

`--recover` alone is rejected; only `--recover=<milliseconds>` runs
recovery. That extra requirement is a small interface decision worth
naming as a teaching pattern: a bare boolean flag toggling a
side-effecting mode is one typo or one copy-pasted command away from
running when the operator meant audit-only. Forcing a value - one this
script deliberately has no default for, since ADR 0005 already named
the staleness threshold an undecided operational knob - means every
invocation of recovery mode carries visible evidence, in the command
itself, that the operator meant to run it and chose a threshold, rather
than inheriting one silently. Worth carrying forward as a default habit
for any future opt-in mutation mode this project builds: prefer a
required value over a bare switch when the switch's whole job is "make
sure this was on purpose."

### DP-0019: Noticing a script's responsibilities are growing is useful on its own, even without acting on it yet

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006's recommended next step)
**Perspective:** Platform Engineer

`detect-unprocessed-events.ts` now sweeps, classifies, maps payloads to
canonical shape, and recovers - visibly more than it did. DP-0003 and
DP-0007 have twice confirmed the value of not adding a boundary before
a second real use demands it; FL-0027 applies the same discipline in
the other direction, at script level rather than `src/`-level: naming
that a script is accumulating responsibility is worth doing explicitly,
even when the answer this round is "not yet a problem, don't split it."
The value isn't the extraction - there isn't one yet - it's having a
named trigger condition (a third composition landing on the same file)
recorded now, so the decision to split it later is made deliberately
against a concrete cause rather than reactively once the file has
already become hard to read.

### DP-0020: One friction entry from two rounds ago just closed its own loop - the clearest sign yet that Enablement's friction becomes real material, not just a record

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006's recommended next step)
**Perspective:** Dojo Director

FL-0025 named a gap: normal redelivery doesn't trigger recovery, and
nothing connects a `GAP` classification to an actual recovery call.
OB-0027 investigated where recovery's payload should come from. ADR
0006 decided it. This round connects the two functions FL-0025 named as
disconnected, under the exact contract ADR 0006 decided, and proves it
end-to-end against real Salesforce and ServiceNow - four rounds,
starting from one implementation-round observation that could easily
have been logged and forgotten. That's the concrete version of what
`CLAUDE.md`'s cycle diagram claims in the abstract: friction recorded
during Enablement isn't just a historical note, it's the actual
material the next several rounds of work are built from, followed
through to a real, tested, manually-triggered composition rather than
left as an open question indefinitely.

### DP-0021: An interface built for one reason quietly satisfied a later, different requirement

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0007, operational-policy design)
**Perspective:** Developer

The previous round required `--recover=<ms>` rather than a bare
`--recover` flag so that recovery could never be triggered by accident
(DP-0018). This round needed audit and recovery to be independently
schedulable, and found that requirement already satisfied - no code
change - by the same flag. Nobody designed the flag with scheduling in
mind; it paid off anyway, because "make the dangerous thing require an
explicit, deliberate argument" and "make the dangerous thing separable
from the safe thing" turned out to be the same discipline applied
twice. Worth remembering the next time a small interface decision looks
like it's only solving today's problem - a genuinely explicit interface
tends to keep being explicit in ways you didn't plan for yet.

### DP-0022: A number that was safe because one specific person understood its history is not a policy - it's a story that hasn't been written down yet

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0007, operational-policy design)
**Perspective:** Dojo Instructor

`--recover=2000` has been typed, correctly, by whoever ran it in every
round so far - because that person had just lived through OB-0022 and
understood precisely what the number meant and didn't mean. That
understanding is not in the code. It's not even fully in the comments.
It's in this project's own accumulated history, which a second
developer inheriting this capability will not have walked through the
same way. The moment automation is even *considered*, that gap stops
being harmless: a scheduled `--recover=2000` would be Developer #1's
lived judgment silently frozen into Developer #2's default, presented
as a working number rather than a placeholder that was never meant to
survive contact with production. ADR 0007's refusal to pick a cadence
or a threshold isn't caution for its own sake - it's the recognition
that teaching a *number* is not the same as teaching the *reasoning*
that number depended on, and a Golden Path has to transmit the
reasoning, not just a value that happened to work in a test. The
concrete teaching artifact this round produces is exactly that
separation, written down where a second developer can find it before
they need it, rather than after something goes wrong.

### DP-0023: This project's first "own the policy, not just the code" platform requirement

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0007, operational-policy design)
**Perspective:** Platform Engineer

Every prior reusable thing this project has built - `idempotencyStore.ts`,
`incidentReconciliation.ts`, the recovery/audit composition - has been
code: something a Platform Engineer packages once and developers
consume unchanged. `staleAfterMs`, once scheduled, is a different kind
of asset: a configuration value that only means something in light of
measured evidence (real ServiceNow call latency) and a documented
justification for the safety margin chosen above it. That's not a
module to extract - it's a policy to own, with its own evidence trail,
that has to be re-justified if the evidence it rests on changes (ADR
0007's own "when to revisit" - built to be reopened deliberately, not
frozen accidentally). Recognizing this as a distinct category of
platform responsibility, separate from reusable code, is itself the
deliverable of this round from this perspective - nothing needed
building yet, but the next round that *does* build the scheduler now
knows it's shipping a policy artifact alongside the mechanism, not just
wiring a cron job around an existing script.

### DP-0024: The project just demonstrated the difference between "this works" and "this is safe to hand to someone else" - and chose not to collapse them

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0007, operational-policy design)
**Perspective:** Dojo Director

OB-0028 answered a mechanical question: can the audit detector and the
recovery function be composed correctly? Yes, proven end-to-end. This
round asked a different question entirely: is it safe to let that
composition run without anyone watching it? The honest answer was no,
not yet - not because the mechanism is wrong, but because part of what
made every run so far safe was a human who understood OB-0022 choosing
when to run it and what threshold to trust. A less disciplined version
of this project would have read OB-0028's success as license to
schedule immediately - "it works, wire up cron." Instead this round
separated *mechanical correctness* from *operational safety* as two
different questions requiring two different kinds of evidence, and
refused to answer the second with the first. That is precisely the
distinction between an integration that works and a Golden Path
capability - the second demands that its safety assumptions be
legible and owned by the platform, not inherited tacitly from whoever
happened to build it. This is the clearest single moment so far where
the project is visibly building the *Path*, not just the integration
the Path is supposed to generalize from.

---

<!-- Add new entries above this line, most recent first. -->
