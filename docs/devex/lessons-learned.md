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
tracked is **not established** — the proto defines a `retention_policy`
on `TopicInfo` that would answer this via a `GetTopic` call, but nothing
in this codebase has ever called it. So "events are permanently lost on
crash," as stated in FL-0012, is accurate for *this codebase's current
behavior*, but it is not yet established whether that's an inherent
platform limitation or a gap in what this codebase does with a capability
Salesforce may already provide.

**Implication:** Not choosing a fix here. The open, directly-testable
question — not yet answered — is whether capturing and reusing
`latestReplayId` with `replayPreset: 'CUSTOM'` actually recovers events
published during a downtime window, and how large that window can be
(bounded by the topic's retention policy, currently unknown). This is
squarely a "go observe it" question before a "go build it" one,
consistent with how FL-0011/FL-0012 themselves were investigated rather
than assumed.

---

**A connection worth naming explicitly, across LL-0005 and LL-0007:** if
checkpoint/replay recovery (LL-0007) is ever implemented, it will almost
certainly *increase* how often duplicate deliveries are seen in practice
— resuming a stream at a checkpoint is inherently an at-least-once
operation (the event at or near the checkpoint may be redelivered).
LL-0005's idempotency gap and LL-0007's checkpoint gap are therefore not
independent problems to solve on separate schedules: whichever is built
first should be designed with the other in mind, or the checkpoint work
should bring its own minimal idempotency handling from the start. This is
a first-party inference from this project's own event model, not a
"that's just how these systems are usually built" assumption.

## Recommended smallest Phase 3 Enablement experiment (not started)

Per the evidence above, the single highest-value, smallest next
experiment is: **capture and use the replay checkpoint, and directly
observe whether it actually recovers a missed event and/or redelivers
the last one** — not build a production retry/idempotency system yet.

Concretely (described here, not implemented — out of scope for this
review):

1. Have `pubsubClient.ts` persist `fetchResponse.latestReplayId`
   somewhere trivial (e.g. a local file) after each `FetchResponse`.
2. On startup, if a stored replay ID exists, use `replayPreset: 'CUSTOM'`
   with it instead of always using `'LATEST'`.
3. Re-run a variant of the FL-0012 experiment: start the subscriber, stop
   it (simulating a crash), publish a test event while it's down, then
   restart and observe directly whether the "missed" event is now
   received — turning LL-0007's open question into a confirmed result.
4. While doing so, also directly observe whether that resume redelivers
   the last successfully-processed event too — confirming or refuting the
   LL-0005/LL-0007 connection above with first-party evidence rather than
   an assumption.

Why this over building retry/dead-lettering/idempotency directly
(LL-0005's and LL-0006's candidates): it's a narrower, more mechanical
change (thread one field through, persist it, use it on startup) with a
clear pass/fail observation, and its result directly informs how urgent
and what-shaped the LL-0005 and LL-0006 work needs to be — rather than
designing an idempotency/retry scheme before knowing how the platform
actually behaves on resume.

---

<!-- Add new entries above this line, most recent first. -->
