# Lessons Learned

This is the synthesized view of the developer experience journal — the
takeaways distilled from `observations.md`, `friction-log.md`, and
`decisions.md` once there's enough history to see a pattern.

Per `CLAUDE.md`, this log matters most during:

- **Phase 2 — Observation Review**, when friction and observations are
  classified and it becomes clear which items represent real, recurring
  problems rather than one-off noise.
- **Phase 6 — Iteration**, when the Golden Path is revised based on the
  second integration's (Salesforce → SharePoint) developer experience.

Do not populate this file speculatively. A lesson belongs here only once it
is backed by evidence in the other DevEx logs — not because it seems likely
to be true.

See also `docs/devex/observations.md`, `docs/devex/friction-log.md`, and
`docs/devex/decisions.md`.

## How to use this log

1. Only add an entry once a pattern is visible across multiple observations
   or friction items — link back to the entries that support it.
2. State the lesson, the evidence for it, and what it should change going
   forward (a Golden Path capability, a process change, or nothing yet).
3. It is fine for this file to stay empty until Phase 2.

---

## Template

### LL-XXXX: <short title>

**Date:** YYYY-MM-DD
**Phase:** <current DevEx Dojo phase>
**Evidence:** <links to supporting entries, e.g. FL-0001, OB-0003>

**Lesson:** What did we learn?

**Implication:** What should this change — for the Golden Path, the process,
or nothing yet?

---

## Phase 2 Review — 2026-09-15

Classification of every entry logged during Phase 1 so far (10 friction
items, 6 observations, 1 working-level decision), per the categories
`CLAUDE.md` suggests. One item, `FL-0010` (OAuth scope not providing real
API-level restriction), had no second supporting entry to form a pattern
with, so per this file's own rule it's left documented in `FL-0010` and
`docs/decisions/0004-servicenow-authentication.md` rather than forced into
a lesson here.

| ID | Category | Status |
|---|---|---|
| FL-0001 | authentication / API discovery | Resolved |
| FL-0002 | authentication / documentation | Open (informational) |
| FL-0003 | authentication / secrets | Open (expected behavior, no fix needed) |
| FL-0004 | environment setup / testing | Resolved |
| FL-0005 | authentication | Resolved |
| FL-0006 | schemas / API discovery | Resolved |
| FL-0007 | authentication / documentation | Open (informational) |
| FL-0008 | authentication / environment setup | Resolved |
| FL-0009 | authentication (usability) | Open (no fix needed structurally) |
| FL-0010 | authentication / secrets | Open (documented gap, deferred) |
| OB-0001–OB-0006 | environment setup, authentication, testing, milestones | — |
| DEC-0001 | environment setup (language choice) | — |

---

### LL-0001: SaaS platforms silently replace their integration-setup UI

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0002, FL-0007

**Lesson:** Both Salesforce and ServiceNow, independently, have replaced
their classic OAuth/integration-app creation UI (Connected Apps → External
Client Apps; Application Registry → Machine Identity Console) with newer
screens that have a different field layout and terminology. In both cases
the old path still technically works, the shift is signaled only by a
banner that's easy to miss, and generic or older tutorials/AI-generated
instructions actively mislead rather than just being out of date.

**Implication:** Any future Golden Path setup guidance for "how to
configure OAuth on Platform X" should carry an explicit instruction to
verify against the platform's current live UI before following steps
verbatim — a static screenshot-based runbook would go stale the same way.
Not building tooling for this yet; just a process note for future
integrations (including the second one, Salesforce → SharePoint).

---

### LL-0002: Never assume identifier casing/format between systems — confirm from the live system

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0005, FL-0006

**Lesson:** Twice in one session, an assumption about a naming/value
convention (the OAuth JWT `aud` claim should be the org's own domain; a
Platform Event's API name should be PascalCase like the conceptual
`eventType`) produced a plausible-looking but wrong configuration. Neither
mistake was caught by reasoning about the spec — both were only caught by
running against the real system and getting back a confusing error, or by
directly reading the actual value off the live record.

**Implication:** When wiring two systems together, treat every
identifier/URL/format as something to verify against the live system's
actual value, never derive it from a pattern, a skimmed spec, or what
"should" be true by convention. Worth stating explicitly in any future
integration checklist, rather than repeating this discovery cost per
integration.

---

### LL-0003: Non-interactive auth setup on both platforms has hidden, easy-to-miss prerequisites

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0003, FL-0008, FL-0009

**Lesson:** Setting up credentials for a service account (no human in the
loop) involved, on both platforms, at least one non-obvious extra step
that the primary configuration screen didn't make clear up front: an email
identity-verification gate on revealing Salesforce's Consumer Key, a
ServiceNow system property that has to be manually created (not just
toggled) before Client Credentials grants work at all, and a ServiceNow
user picker that searches by display name rather than the user ID it's
nominally selecting. None of these were discoverable except by trying the
obvious thing first and hitting a wall.

**Implication:** A reusable per-platform "non-interactive auth setup
checklist" (not automation — some steps like email verification are
inherently manual) could shorten this for whoever builds the second
integration. This is a genuine Phase 3 (Enablement) candidate, not
something to build now.

**Acted on 2026-09-15:** Wrote
`docs/runbooks/salesforce-non-interactive-auth-setup.md` and
`docs/runbooks/servicenow-non-interactive-auth-setup.md`, capturing the
actual steps and gotchas hit in this session (including FL-0002/FL-0007's
UI-drift lesson and FL-0010's scope limitation) rather than idealized
generic instructions. Both Phase 3 candidates from this review are now
acted on.

---

### LL-0004: Scripting repetitive platform setup via its own API beat manual UI clicking

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** OB-0004, OB-0005

**Lesson:** Once initial authentication was working, using it to script
repetitive, mechanical setup (creating 9 Platform Event fields via
Salesforce's Tooling API in one script run instead of 9 manual form
submissions; publishing test events via a small reusable script instead of
manually filling Setup forms each time) was both faster and left behind a
reusable, re-runnable artifact instead of one-off manual state.

**Implication:** This is the strongest Phase 3 (Enablement) candidate so
far: a small library of setup/test scripts, built on the same auth modules
already written, could become part of the Golden Path's onboarding tooling
for future integrations - schema setup and test-event publishing
especially. Not building this generalized/reusable version yet; the two
scripts that exist (`scripts/create-platform-event-fields.ts`,
`scripts/publish-test-event.ts`) remain Salesforce/this-integration
specific for now.

**Acted on 2026-09-15:** Extracted the Tooling API `CustomField` call into
`scripts/lib/salesforceTooling.ts` (reused by
`create-platform-event-fields.ts`), and added
`scripts/verify-recent-incidents.ts` to close the ServiceNow-side
verification loop that previously required opening the browser. Kept
local to this service rather than a shared package across services/ —
per `CLAUDE.md`'s Developer #1 principle, there's still only one real
consumer, so a cross-integration package remains premature until Phase 5
(the SharePoint integration) actually needs one.

---

## Phase 2 Review — 2026-09-15 (second pass)

Triggered by a deliberate experiment (`OB-0007`) that directly tested two
of `CLAUDE.md`'s own Developer #1 friction questions — "How do I prevent
duplicate processing?" and "What happens when ServiceNow is
unavailable?" — rather than guessing at retry/idempotency requirements.
Unlike the first review, each lesson below is backed by only one
friction entry plus the shared `OB-0007` observation of the experiment
itself; that's treated as sufficient here because the friction was
*deliberately targeted*, not incidentally noticed, so the "pattern" is
the question-asked-and-answered, not repetition across unrelated
incidents. No reliability code is added as part of this review — see
`docs/devex/friction-log.md` FL-0011/FL-0012 for the raw findings this
draws on.

| ID | Category | Status |
|---|---|---|
| FL-0011 | error handling (duplicate delivery / idempotency) | Open (root cause understood, no fix chosen) |
| FL-0012 | error handling / observability (failure isolation, recoverability) | Open (root cause understood, no fix chosen) |
| OB-0007 | testing / error handling | — |

### LL-0005: Duplicate business-event delivery has no idempotency boundary anywhere

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0011, OB-0007

**Lesson:** Publishing the same logical event twice (same
`Event_Id__c`/`Correlation_Id__c`) produced two separate ServiceNow
Incidents. This is a directly observed fact: there is no idempotency
check anywhere in the chain — not on receipt in the subscriber (no dedup
by `eventId` or `replayId`), and not on the ServiceNow side (Incident
creation doesn't check for an existing Incident with the same
`correlation_id` first).

What this test covered, precisely: an upstream/application-level
duplicate — the same event republished by whatever calls the publish API
(in production, this would be Salesforce itself, e.g. a re-fired
workflow). It did **not** test genuine Pub/Sub transport-level
redelivery — Salesforce's own at-least-once guarantee after a dropped
connection or a late acknowledgment — which we have not separately
forced. Both would look identical to the subscriber (the same
`Correlation_Id__c` arriving twice), so a `correlation_id`-based fix
would very likely cover both, but that's an inference connecting the two,
not something independently confirmed for the transport-level case.

**Implication:** Not choosing an architecture here — these are candidates
to weigh later, not a decision:
- Query ServiceNow for an existing Incident with the same
  `correlation_id` before creating one (dedup at the point of the side
  effect).
- Track seen `eventId`/`replayId` values in the integration service
  before calling ServiceNow at all (dedup at the point of receipt).
- Rely on ServiceNow-side configuration (e.g. a Before Insert Business
  Rule or a unique constraint on `correlation_id`) so ServiceNow itself
  refuses/merges the duplicate — shifts the responsibility off the
  integration service's code entirely.

Each has different failure characteristics (race conditions between
check-and-create, extra API calls / latency, coupling to ServiceNow admin
configuration outside this codebase) that haven't been evaluated against
each other yet. See the connection to LL-0007 below before picking one.

---

### LL-0006: An unhandled per-event error crashes the whole subscriber, and there is no retry of any kind

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0012, OB-0007

**Lesson:** A ServiceNow HTTP failure during event processing threw
inside the `async` callback passed to the gRPC stream's `'data'`
listener (`src/salesforce/pubsubClient.ts`). That exception isn't caught
anywhere in the call chain (`pubsubClient.ts` → `subscriber.ts` →
`index.ts`), so it surfaced as an unhandled promise rejection and killed
the Node process — directly confirmed (`ps aux` showed no process
afterward). There is currently no retry logic anywhere in the code: no
per-event retry/backoff, no dead-lettering, and no process-level restart
supervision configured.

Separately, and **not yet tested**: `pubsubClient.ts`'s `stream.on('error', ...)`
handler (a different code path from the one actually triggered) itself
calls `throw` synchronously. A gRPC channel-level error — token expiry, a
network blip — would very plausibly crash the process the same way, via
this other path. This is a reasonable inference from reading the code,
not a directly observed failure, and shouldn't be treated as confirmed
until it's actually forced and watched, the same way FL-0012 was.

**Implication:** Not choosing a fix here — candidates, not a decision:
- Wrap the per-event handler in a try/catch so one event's failure
  doesn't propagate to the process, paired with structured logging of the
  failure (event ID, error) so it isn't silently dropped either — naive
  catch-and-ignore would trade "loud total outage" for "silent partial
  data loss," which is not obviously an improvement.
- Add retry-with-backoff specifically around the ServiceNow call, on the
  theory that many ServiceNow failures (throttling, transient network
  issues) are retryable.
- Add dead-lettering: park failed events somewhere durable for
  manual/automated reprocessing instead of retrying inline.
- Add process-level supervision (a restart-on-crash wrapper) as a
  coarser, complementary safety net regardless of in-code handling.

These aren't mutually exclusive, and none has been evaluated against this
project's actual failure rate — which is currently unknown, since the
only failure induced so far was deliberately forced, not naturally
observed over time.

---

### LL-0007: No replay checkpoint exists, so recovery after a restart is currently impossible — though Salesforce's own retention may make it possible in principle

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0012, code inspection of `src/salesforce/pubsubClient.ts`

**Lesson:** The subscriber always requests `replayPreset: 'LATEST'` on
connect and never reads or persists `FetchResponse.latestReplayId` — the
field the Pub/Sub API explicitly provides for this purpose (the proto's
own comment: "Enables clients... to keep track of their last consumed
replay"). Even the per-event `replayId` that *is* threaded through
`pubsubClient.ts` gets dropped one layer up, in `subscriber.ts`, which
only forwards the decoded payload. Directly confirmed by reading the
code, not inferred.

Consequence: after any restart (crash or deliberate), the subscriber has
no way to resume from where it left off — it only receives events
published after the new connection opens. Whether Salesforce's Pub/Sub
API could actually replay the "missed" window *if* a replay ID were
tracked was **not established** at the time this lesson was first
written — ~~the proto defines a `retention_policy` on `TopicInfo` that
would answer this via a `GetTopic` call~~. **That claim was wrong — see
FL-0013.** `GetTopic` was called directly (`scripts/get-topic-info.ts`)
and returns only `topicName`, `tenantGuid`, `canPublish`, `canSubscribe`,
`schemaId`, `rpcId`; no retention field exists in this proto at all. The
actual retention window remains unconfirmed by this project — it isn't
discoverable via this API's schema, only (if at all) via Salesforce's own
product documentation, which hasn't been checked.

**Implication:** Not choosing a fix here. The open, directly-testable
question — not yet answered — is whether capturing and reusing
`latestReplayId` with `replayPreset: 'CUSTOM'` actually recovers events
published during a downtime window, and how large that window can be
(bounded by the topic's retention, still unknown). This is squarely a "go
observe it" question before a "go build it" one, consistent with how
FL-0011/FL-0012 themselves were investigated rather than assumed.

**Resolved 2026-09-15 (Phase 3 experiment, OB-0008):** Implemented the
minimal checkpoint described above (`src/salesforce/checkpoint.ts`,
wired into `pubsubClient.ts`) and directly tested it: published an event,
let it process and checkpoint, stopped the subscriber, published a second
event while offline, then restarted. **The offline event was recovered**
— received and turned into a ServiceNow Incident after restart, using
`ReplayPreset.CUSTOM` from the persisted checkpoint. This resolves the
core question this lesson raised. What remains unresolved: the retention
window itself (still unknown — untested at any delay beyond roughly a
minute), and a narrower timing question raised by the experiment itself —
see LL-0008.

---

### LL-0008: The checkpoint-write timing gap is a second, more specific duplicate-delivery vector than the one LL-0005 found

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0014, OB-0008, code inspection of `src/salesforce/pubsubClient.ts`

**Lesson:** The replay-checkpoint experiment (OB-0008) directly tested
whether `ReplayPreset.CUSTOM` redelivers the already-checkpointed event
on a clean restart — it does not (confirmed: exactly one ServiceNow
Incident for the checkpointed event, not two). But that test only
covered the case where the checkpoint was written *before* the process
stopped normally. Reading `pubsubClient.ts` shows `saveCheckpoint()` runs
*after* `onEvent` resolves (i.e. after the ServiceNow Incident is already
created) — so there is a real window, between an event being fully
processed and its checkpoint reaching disk, where a crash would leave the
*previous* checkpoint in place. Restarting from that stale checkpoint
would very plausibly cause Salesforce to redeliver the just-processed
event, and the integration service would create a second ServiceNow
Incident for it — a duplicate, via a different mechanism than LL-0005's
double-publish scenario (this one is purely about our own persistence
timing, not about Salesforce or an upstream caller sending the same
event twice).

This is an inference from reading the code, explicitly **not yet
directly observed** — no experiment has forced a crash inside that
specific window.

**Implication:** Not choosing a fix here. This sharpens LL-0005/LL-0007's
general "checkpointing and idempotency are coupled" observation into a
specific, testable claim: *a crash between processing and
checkpoint-persistence causes a duplicate.* That's the next smallest
thing worth directly observing — see the recommendation below — before
deciding whether the fix belongs in checkpoint semantics (e.g. write
checkpoint *before* calling ServiceNow, trading a different failure mode:
a processed event whose checkpoint says it wasn't), in idempotency at the
ServiceNow side, or somewhere else. This is also where the "last
received" vs. "last successfully processed" semantic question
(deliberately left open per this experiment's instructions) would become
concretely observable: writing the checkpoint *before* `onEvent` instead
of after would close the crash-duplication gap but reopen a
"checkpoint says done, but it wasn't" risk on ServiceNow failure — the
same trade-off LL-0006 already named for error handling generally.

**Resolved 2026-09-15 (Phase 3 experiment, OB-0009, FL-0015):** Directly
confirmed with a deterministic test. Added a single env-var-gated crash
point (`EXPERIMENT_CRASH_BEFORE_CHECKPOINT`) between `onEvent` succeeding
and `saveCheckpoint()` running - no idempotency, dedup, retry, or
correlation-ID lookup was added. Result: Salesforce redelivered the
event after restart, and the integration service created a **second**
ServiceNow Incident for the identical `correlationId`
(`INC0010007` and `INC0010008`), independently confirmed via
`verify-recent-incidents.ts` rather than the service's own logs alone.
The inference above was correct. What remains open: whether writing the
checkpoint *before* calling ServiceNow instead would avoid this without
introducing a worse silent-loss failure mode - not tested, see the
recommendation below.

---

**A connection worth naming explicitly, across LL-0005, LL-0007, and
LL-0008:** checkpointing and idempotency are not independent problems to
solve on separate schedules. LL-0007's experiment showed checkpointing
*can* work without producing a duplicate in the clean-shutdown case, which
is a real, positive result — but LL-0008 shows the general
"at-least-once" concern raised when LL-0007 was first written wasn't
wrong, just imprecise: the risk isn't checkpoint resume *in general*, it's
specifically the gap between processing and persisting the checkpoint —
and that gap is now confirmed to actually produce duplicates in practice,
not just in theory.

---

### LL-0009: The two checkpoint orderings have distinct, mutually exclusive, directly-confirmed failure modes — neither is simply "safer"

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0015, FL-0016, OB-0009, OB-0010

**Lesson:** Both possible orderings of "persist checkpoint" relative to
"call ServiceNow" have now been directly tested with the same
deterministic-crash method, not just reasoned about:

| Ordering | Crash point | Confirmed result |
|---|---|---|
| Checkpoint **after** ServiceNow (current default) | After Incident created, before checkpoint saved | Event **redelivered**; **duplicate** ServiceNow Incident created (FL-0015, OB-0009) |
| Checkpoint **before** ServiceNow (reversed for this experiment only) | After checkpoint saved, before ServiceNow called | Event **not redelivered**; **no** Incident ever created — business operation silently skipped (FL-0016, OB-0010) |

Neither ordering is a free improvement over the other — each fully
prevents the other's failure mode while fully exhibiting its own.
Deliberately not picking one here: a duplicate is visible and mergeable
after the fact; a silent loss is not detectable at all with what
currently exists in this codebase (see the observability finding in
OB-0010 — the crash-before-ServiceNow path produces no
business-identifiable log trail). That asymmetry in *detectability*,
not just in "does it happen," is itself a new finding neither individual
experiment surfaced on its own — it only became visible by running both
and comparing.

**Implication:** Not choosing an architecture here, as instructed. What
this comparison does establish: fixing this by picking "the less bad"
ordering alone is not a real fix, since ordering B's failure mode is
strictly harder to detect than ordering A's, even if it might be argued
to be no more or less *frequent*. A durable fix likely needs either (a)
a genuine correctness mechanism (idempotency and/or a server-side commit
protocol, not just checkpoint reordering), or (b) at minimum, a way to
detect when the silent-loss failure mode has occurred after the fact.
(b) is smaller and orthogonal to picking an architecture — see LL-0010.

---

### LL-0010: A silent loss can be detected after the fact by two independent methods — detection is real, but not automatic

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** FL-0017, OB-0011

**Lesson:** LL-0009's open question - can a silent loss be found after
the fact - is resolved: yes, confirmed two ways.
`src/salesforce/pubsubClient.ts`'s new `replayRange()` can replay either
from a specific known-old position (`ReplayPreset.CUSTOM`) or from
`ReplayPreset.EARLIEST` (a full sweep). Both were tested against the real
org: the targeted replay retrieved Event E's exact data using Event D's
checkpoint as an anchor; the full sweep independently retrieved **all 11
events** ever published in this project's testing and, cross-referenced
against ServiceNow, correctly classified every single one - including a
gap unrelated to LL-0009 entirely (an event that predates the ServiceNow
adapter's existence), with zero false positives or negatives against
known history.

Two limits found along the way, both real and worth keeping in mind
rather than treated as solved:

- **Detection needs *something* to anchor or bound it.** Targeted replay
  needs a known-old position, and `checkpoint.ts` currently retains none
  (`writeFileSync` overwrites, no history) - the only reason Event D's
  position was usable here is that it was recorded in conversation
  history, not by the running system. `EARLIEST` sidesteps this but
  scales with retention and event volume, neither of which is bounded or
  known (FL-0013 already established `GetTopic` doesn't expose
  retention).
- **This method finds absence, not multiplicity.** It correctly flagged
  Event E (zero Incidents) but reported both "Duplicate Test Co" and
  Event D as `OK`, despite each genuinely having two Incidents (LL-0005,
  LL-0008's confirmed duplicates) - because the underlying query only
  checks existence. Detecting *that* failure mode the same way would need
  counting, not existence-checking.

**Implication:** Detection is now a real, working, on-demand capability
(`npm run detect-unprocessed-events`), not a hypothesis. It is not,
however, automatic - nothing in this codebase currently triggers a sweep
on any schedule or event; today it requires a human to decide to run it.
That gap between "can detect" and "does detect" is itself the next thing
worth being deliberate about, rather than assuming a manual tool is
sufficient going forward.

**Resolved 2026-09-15 (Phase 3 improvement, OB-0012):** The
"finds absence, not multiplicity" limit above is closed. The detector now
classifies `GAP` (0 Incidents) / `OK` (1) / `DUPLICATE` (>1), with a
distinct `UNEVALUABLE` category for events predating
`Correlation_Id__c`. Validated against the complete 11-event history with
zero discrepancies from the independently-predicted result - see OB-0012
for the full comparison table. The remaining limit - detection is
on-demand, not automatic - is unchanged and still open.

---

### LL-0011: A validated audit tool is not the same as a monitored system — "can detect" still requires a human to run it

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Evidence:** OB-0012

**Lesson:** With counting added, `detect-unprocessed-events.ts` now
correctly classifies every known failure mode this project has
deliberately produced (silent loss, duplicate, and even a historical gap
from before the ServiceNow adapter existed) in a single pass, validated
against independently-recorded history with zero discrepancies. That's a
meaningfully complete *diagnostic*. It is still not a *safeguard*:
nothing triggers it, so a real silent loss or duplicate in an unattended
run would sit undetected exactly as long as no one thinks to run the
tool - the same gap LL-0010 already named, now more clearly the last
piece standing between "we can find this" and "this gets found."

A second, smaller-but-real limit surfaced during validation, not before:
the tool currently re-sweeps from `EARLIEST` (or a manually-supplied
anchor) on every run - fine at 11 events, but with no persisted "last
audited position" of its own, every run re-checks the entire retained
history from scratch. That's a cost that grows with retention and event
volume, neither of which is known (FL-0013).

**Implication:** Not choosing to automate the tool yet, and not choosing
an architecture for the underlying duplicate/silent-loss problem, as
instructed throughout this investigation. What's left before either of
those decisions makes sense: making the audit tool itself efficient to
re-run (its own incremental position, separate from the runtime
checkpoint) is a smaller, more clearly "still just an instrument" step
than deciding whether/how to run it automatically.

---

## Recommended smallest Phase 3 Enablement experiment (not started)

The prior recommendation (extend the detector to catch duplicates, not
just silent loss) has been **completed** — see OB-0012: validated with
zero discrepancies against known history. This section recommends the
next step based on the combined evidence, without selecting an
architecture for the underlying problem and without automating the tool.

**Recommended: give the audit tool its own persisted "last audited
position," entirely separate from the runtime subscriber's
`checkpoint.ts`, so repeat runs can sweep incrementally instead of
re-replaying the full retained history every time.** Concretely
(described, not implemented): a second, clearly-named state file (e.g.
`.audit-checkpoint.json`) written only by `detect-unprocessed-events.ts`
after a successful run, read back in on the next run as the default
`from` position instead of `EARLIEST`. This stays strictly inside the
audit tool's own scope - it does not touch `checkpoint.ts`,
`subscriber.ts`, `pubsubClient.ts`'s `subscribe()`, or any runtime
processing/replay/idempotency/retry behavior, matching this round's
constraint even though it isn't bound by it going forward. It's smaller
than either remaining larger step (automating the sweep, or choosing a
fix architecture) and is a direct, mechanical response to the one new
limit this round's validation actually surfaced - not a guess about what
might matter next.

**Noted but not recommended yet, as larger steps:** running the sweep
automatically (on a schedule, or triggered by restart) remains the step
that would close the "not automatic" gap LL-0010/LL-0011 both named, but
building any run-trigger is a step toward a real mechanism, appropriately
deferred until the underlying fix architecture is chosen. `ManagedSubscribe`'s
`CommitReplayRequest`/`Response` flow also remains noted, larger, and
deferred.

**Deliberately deferred 2026-09-15:** explicitly kept as a recorded
candidate rather than built, so the project could move to the reliability
architecture spike (`docs/decisions/0005-reliability-architecture-spike.md`)
instead. The audit tool (`scripts/detect-unprocessed-events.ts`) remains
unchanged from OB-0012's validated state.

---

<!-- Add new entries above this line, most recent first. -->
