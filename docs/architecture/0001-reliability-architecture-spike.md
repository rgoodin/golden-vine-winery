# Architecture Spike: Guaranteeing Exactly-One Incident per Business Event

**Status:** SPIKE — investigation only. No decision made, no ADR written.
**Date:** 2026-09-15 (updated same day with a focused ServiceNow
target-side idempotency follow-up — see §3a and §3b)
**Related:** `docs/devex/friction-log.md` FL-0011–FL-0018,
`docs/devex/observations.md` OB-0007–OB-0015,
`docs/devex/lessons-learned.md` LL-0005–LL-0012,
`docs/decisions/0001`–`0004`

## Purpose

Investigate how this integration should guarantee the business invariant:

> For each evaluable `DistributorOnboardingRequested` business event,
> exactly one intended ServiceNow Incident should result.

This document does not select an architecture. No idempotency, retries,
durable processing state, `ManagedSubscribe`, or other reliability
mechanism has been implemented as part of this investigation - confirmed
by `git status` showing no source changes alongside this document.

---

## 1. What our experiments have established (only that)

Restated from the DevEx journal, not reinterpreted:

1. **Processing before checkpointing (current default ordering) can
   produce duplicate side effects when the process fails in the commit
   gap.** A crash between "ServiceNow Incident created" and "checkpoint
   persisted" caused Salesforce to redeliver the event on restart, and
   the integration created a second Incident for the same
   `correlationId` (`INC0010007` + `INC0010008`). [FL-0015, OB-0009]
2. **Checkpointing before processing can produce a missing side effect
   when the process fails in the opposite gap.** A crash between
   "checkpoint persisted" and "ServiceNow called" left the checkpoint
   already past the event; on restart it was never redelivered, so
   ServiceNow was never called - zero Incidents, no log trail. [FL-0016,
   OB-0010]
3. **`ReplayPreset.CUSTOM` can recover an event published while the
   subscriber is offline.** A test event published during a deliberate
   offline window was received and processed after restart. [OB-0008]
4. **A clean checkpoint/restart did not duplicate the already-checkpointed
   event in our test.** After a normal (non-crashed) checkpoint save and
   restart, the already-processed event was not redelivered -
   `ReplayPreset.CUSTOM` is confirmed to resume strictly *after* the
   given replay ID, not from it. [FL-0014, OB-0008]
5. **An audit tool can independently identify `GAP`, `OK`, `DUPLICATE`,
   and `UNEVALUABLE` outcomes.** Validated with zero discrepancies against
   this project's complete 11-event known history, via both a
   targeted-anchor replay and a full `EARLIEST` sweep, counting matching
   ServiceNow Incidents per `correlationId`. [OB-0011, OB-0012]

No other claims in this document are treated as established fact -
everything below is either new platform investigation (cited to its
source) or explicitly marked as reasoning/inference, not evidence.

---

## 2. Two identities our experiments have exposed

- **Salesforce event/replay identity** - `replay_id` (a transport
  position, monotonic within one subscription). Each event also carries
  a `ProducerEvent.id` ("either a user-provided ID or a system generated
  guid" - per `pubsub_api.proto`), a distinct field not currently used by
  this integration.
- **Business operation/correlation identity** - `Correlation_Id__c`, a
  custom field this project added (`docs/decisions/0003-platform-event-schema.md`),
  currently populated by our own test publisher
  (`scripts/publish-test-event.ts`) via `randomUUID()`.

**Which should govern idempotency, and why:** `replay_id` structurally
cannot govern business-level idempotency. It identifies a position in a
transport stream, and `CUSTOM` replay resumes strictly after a given
position (fact 4 above) - so it can only ever prevent literal redelivery
of the *same underlying Platform Event record*. It says nothing about
two *different* Platform Event records representing the same business
operation - which is exactly what FL-0011's double-publish test produced:
two distinct Salesforce events, each with its own `replay_id`, both
carrying the same `Correlation_Id__c`. Replay-based dedup is incapable of
catching that case by construction, not by omission.

Business identity (`Correlation_Id__c` or a successor) is therefore the
correct governing identity for this invariant - not because it is
inherently trustworthy, but because it is the only identity that spans
what our own experiment already proved can be more than one Salesforce
transport event.

**But do not assume `Correlation_Id__c` is sufficient as currently
implemented**, per this investigation's explicit instruction:

- It is entirely controlled by the publisher. In this project so far,
  that publisher is our own test script, which mints a fresh UUID by
  default but can send a fixed value on request - precisely how FL-0011's
  duplicate was simulated.
- In production, the real publisher would be Salesforce-side automation
  (a Flow or Apex trigger) that **does not exist yet in this project**.
  Whether that publisher would reliably reuse the same
  `Correlation_Id__c` across its own retries, or mint a new one each
  attempt, is an upstream design decision nobody has made. If it doesn't
  guarantee stability across its own retries, correlation-keyed dedup
  would not catch that class of duplicate, even though it catches every
  case tested so far.
- No uniqueness or format contract exists for `Correlation_Id__c` beyond
  `Text(36)` (`docs/decisions/0003-platform-event-schema.md`) - nothing
  enforces it is actually a well-formed, stable UUID upstream of our own
  test tooling.

`Correlation_Id__c` (or a successor business key) should govern
idempotency, but its reliability is only as strong as an as-yet-unwritten
upstream publishing contract. That contract is a requirement this
investigation surfaces, not something it can close alone.

---

## 3. Platform findings summary

**ServiceNow:**
- The Table API's standard `PUT`/`PATCH` verbs operate on a known
  `sys_id` - there is no documented "upsert by arbitrary field" verb on
  the plain Table API. (Based on documented API shape; not independently
  re-tested here.)
- **Confirmed empirically, not inferred:** this instance's
  `incident.correlation_id` currently has **no** uniqueness enforcement -
  two Incidents were created with an identical `correlation_id` via plain
  Table API `POST`s, twice, with zero errors (FL-0011, FL-0015).
- Attempted to inspect `sys_dictionary` directly to check whether/how a
  uniqueness constraint could be added, using the dedicated `itil`-role
  integration user - **blocked**: "Insufficient rights to query
  records." Schema-level investigation needs privileges beyond what
  ADR 0004 deliberately granted this integration (OB-0015). **This was
  followed up with a real admin session - see §3a and §3b below, which
  supersede this bullet's original "blocked, unresolved" status with
  concrete findings.**
- Import Sets + Transform Maps support "coalesce" fields, a documented
  ServiceNow pattern for upsert-by-arbitrary-key on import - a real,
  known capability, but **not independently verified against this
  instance**, and switching from the Table API to Import Sets is an
  architecture change (different endpoint, asynchronous transform,
  admin-level setup), not a config tweak. Still not verified - out of
  scope for §3a/§3b's focused follow-up, which targeted `sys_index`
  instead (the mechanism actually discovered by inspecting the schema
  directly, per below).

### 3a. Admin-access schema investigation (this round's follow-up)

Conducted via a human-authenticated ServiceNow admin browser session -
**not** by expanding the `itil` OAuth credentials' privileges (OB-0015).

- **Confirmed empirically:** `sys_dictionary` has no native "Unique"
  checkbox on either `task.correlation_id` or `task.number` in this
  instance, checked exhaustively including the Dictionary Entry form's
  "Advanced view." The original spike's framing ("blocked, so unknown")
  was itself incomplete in one respect - even with full access, this
  specific mechanism doesn't exist on this instance the way it might on
  others; **`sys_dictionary` was never going to be the answer.**
- **The real mechanism is `sys_index`:** a `unique_index` boolean,
  `access_method` (e.g. `btree`), keyed to a table + one or more
  columns. Getting one actually persisted proved to be its own
  unresolved obstacle - **see FL-0018 for the full account.** In short:
  a direct `sys_index.do` record submission was rejected server-side
  (`Invalid insert`); the platform's own purpose-built "Database
  Indexes" creation wizard (reached from the Incident table's schema
  record) accepted a fully-configured request (custom field selected,
  "Unique Index" checked) and returned `200`/success-shaped responses
  across three separate submission attempts, but **no index record was
  ever actually persisted**, confirmed via a verified-working filtered
  query before and after each attempt.
- **This is inconclusive, not a definitive "ServiceNow can't do this."**
  It might be a licensing gate, an async background job this session
  didn't wait long enough for, or an instance-specific quirk - the
  wizard gave no error to explain the gap. What it *does* establish is
  that "ServiceNow supports unique indexes" (true in general, per
  ServiceNow's own platform documentation) is not the same claim as "an
  admin can reliably add one to the Incident table through the standard
  UI here" - and that gap is itself relevant operational evidence, not
  just a research inconvenience (see LL-0012).

### 3b. Concurrency experiment: what happens today, with no enforced constraint

Per this round's explicit instruction, this was **not** tested as
"create, then look up, then don't create" (which only proves the
integration's own code can query before writing). Instead:
`scripts/test-servicenow-concurrent-idempotency.ts` generates one
business-operation ID, then fires two Incident-create `POST` requests
**concurrently, via `Promise.all`**, against `/api/now/table/incident`,
using a dedicated custom field (`u_gv_business_operation_id` - created
for this investigation, `String(64)`, permitted per this round's
instructions since the existing `correlation_id`/`Correlation_Id__c`
semantics were not to be assumed sufficient - see §2) - using the
existing `itil`-role OAuth credentials, no privilege change.

**Result (OB-0014):** both requests received `201 Created`. ServiceNow
created **two separate Incidents** (`INC0010009`, `INC0010010`) for the
identical business-operation ID. Neither caller was rejected or told
about the other - both received ordinary, full success responses. An
independent follow-up `GET` query confirmed both records exist.

This directly answers this document's core question for the
**unconstrained configuration**: no, ServiceNow does not incidentally
prevent this - two Incidents resulted from one business operation
requested twice, concurrently, exactly as the risk diagram predicted.
Whether a *successfully enforced* unique index (had §3a's attempts
succeeded) would have produced a different, single-winner result remains
genuinely untested - this experiment could only exercise the
configuration that actually exists in this instance today.

As a side effect, this experiment also resolves one item from §6's
original unresolved-questions list: the follow-up `GET` reliably found
both newly-created records immediately after their `POST`s completed -
no read-after-write staleness was observed for this Table API endpoint
in this test.

**Salesforce:**
- `ManagedSubscribe` is explicitly marked "part of an open beta release,"
  subject to Salesforce's Beta Services Terms, in the proto itself - a
  real maturity concern for a production dependency.
- Using it requires first creating a `ManagedEventSubscription` Tooling
  API record and referencing its `subscription_id`/`developer_name` -
  additional Salesforce-side setup this project hasn't done, comparable
  in kind to the Platform Event object itself (FL-0004).
- `CommitReplayRequest` carries exactly one piece of information: a
  `replay_id` to commit. Nothing in `CommitReplayRequest`,
  `CommitReplayResponse`, `ManagedFetchRequest`, or `ManagedFetchResponse`
  references any downstream system, side effect, or business identity.
- `CommitReplayResponse`'s own documentation states there is no
  guaranteed 1:1 request-to-response mapping ("N `CommitReplayRequest`(s)
  can get compressed in a batch") - even the commit acknowledgment is
  asynchronous/batched.

**No existing project documentation was found to be wrong this round.**
(Contrast with the prior investigation, which corrected LL-0007's
incorrect claim about `GetTopic` exposing a `retention_policy` field -
FL-0013. This round's platform investigation is consistent with
everything already recorded.)

---

## 4. Candidate approaches

### A. Target-side idempotency (ServiceNow enforces it)

**What was investigated:** whether ServiceNow can enforce or naturally
support idempotent creation keyed on an external/correlation identifier
- including, this round, a direct concurrency experiment against the
unconstrained field and three attempts (via real admin access) to
actually create a platform-enforced unique index. See §3a/§3b for the
concrete results.

**Failure-mode analysis:**

| Failure mode | Result |
|---|---|
| Crash before target side effect | Safe - nothing happened yet |
| Crash after target side effect, before checkpoint | **Unproven, not solved.** Would require a real uniqueness mechanism (e.g. a `sys_index` unique constraint, or Import Set coalesce) - attempts to create one this round did not succeed (FL-0018/§3a). Confirmed *without* one, two concurrent creates both succeed (§3b) |
| Replay/redelivery | Same as above - depends entirely on the unproven enforcement mechanism |
| Duplicate source publication (same `correlationId`) | **Directly tested and failed to hold**, for the current (unconstrained) configuration: two concurrent requests for the same business-operation ID both created an Incident (OB-0014) |
| Temporary ServiceNow failure | Unaddressed - orthogonal |
| Process restart | Same dependency as redelivery, above |

If a real enforcement mechanism could be made to work, this candidate
would still let the integration keep today's *simpler* checkpoint
ordering (checkpoint after ServiceNow) safely - the duplicate-prevention
work would move entirely to ServiceNow, and FL-0015's failure mode would
stop mattering. That conclusion now carries a bigger "if" than the
spike's first pass could know: the enforcement mechanism itself is the
open question, not a detail to fill in later.

### B. Lookup-before-create / correlation-based processing

**What was investigated:** querying ServiceNow for an existing Incident
by `correlation_id` before creating one - the same Table API `GET` this
project has already used and validated repeatedly
(`verify-recent-incidents.ts`, `detect-unprocessed-events.ts`).

**Failure-mode analysis:**

| Failure mode | Result |
|---|---|
| Crash before target side effect | Safe |
| Crash after target side effect, before checkpoint | **Mitigated, not solved** - a race exists if the check-then-create isn't atomic; whether a `GET` immediately after a `POST` reliably sees the new record (read-after-write consistency) was **not tested** |
| Replay/redelivery | Mitigated - in practice our redeliveries happened many seconds later, past any plausible indexing delay, but the race window exists in principle |
| Duplicate source publication | Mitigated, same reasoning |
| Temporary ServiceNow failure | Unaddressed |
| Process restart | Mitigated, same as redelivery |

Smallest change of the four candidates - a few lines in
`incidentAdapter.ts` - but a mitigation, not a guarantee, unless paired
with Candidate A to close the race.

### C. Integration-owned durable processing state

**What was investigated:** maintaining durable state, independent of the
Salesforce replay checkpoint, recording event-processing status (e.g.
"in-flight" / "completed") keyed by `Correlation_Id__c`. This is a
design-pattern question (the idempotency-key / outbox pattern), not a
platform-capability question - no further Salesforce/ServiceNow research
applies beyond what's already established.

**Design sketch, not implemented:** before calling ServiceNow, atomically
record "processing started" for this `correlationId` (no-op if already
recorded); after ServiceNow succeeds, atomically record "completed." A
single-value-overwrite file like `checkpoint.ts` is **not** sufficient
for this - FL-0017 already demonstrated that naive local-file state
isn't durable/historical enough even for the simpler replay-position
problem. This would need real atomic/transactional semantics (e.g. a
datastore with a unique constraint or compare-and-set), which this
project has never needed and doesn't have.

**Failure-mode analysis:**

| Failure mode | Result |
|---|---|
| Crash before target side effect | Ambiguous without careful design - an "in-flight" mark alone doesn't prove whether ServiceNow was actually called; would need reconciliation (cf. the audit tool) unless the store atomically captures the ServiceNow response |
| Crash after target side effect, before checkpoint | **Solved**, if implemented correctly - a retry sees "already completed" and skips re-creating |
| Replay/redelivery | **Solved**, same mechanism |
| Duplicate source publication | **Solved** - keyed on business identity, not replay position, matching Candidate A's coverage |
| Temporary ServiceNow failure | Could be extended to support real retry-with-backoff, which no other candidate addresses - but designing that further is out of this investigation's scope |
| Process restart | **Solved**, same as the crash cases above |

Most complete and most platform-agnostic candidate on paper, but the
largest to build - real durable storage is net-new infrastructure for
this project, and it doesn't remove the need to also decide checkpoint
ordering; it solves the business-idempotency problem independently of,
not instead of, that decision.

### D. Salesforce Pub/Sub `ManagedSubscribe` / `CommitReplay`

**What was investigated:** read directly against
`src/salesforce/proto/pubsub_api.proto` rather than assumed. See Platform
Findings above.

**Conclusion, answering directly what this investigation asked:**
`ManagedSubscribe`/`CommitReplay` addresses **only the replay/checkpoint
problem** - specifically, it could replace this project's local,
single-value-overwrite `.checkpoint.json` (FL-0017's stated limitation:
no history, single point of failure, not shared across instances) with
server-side, durable position tracking. It does **not** solve, and was
never designed to solve, the side-effect atomicity problem this
investigation is about. The exact same question - commit before or after
calling ServiceNow? - would still have to be answered, with the exact
same two failure modes this project already demonstrated, just relocated
from a local file to a Salesforce-hosted commit call.

**Failure-mode analysis (adopted alone, without A/B/C):**

| Failure mode | Result |
|---|---|
| Crash before target side effect | Unaffected |
| Crash after target side effect, before commit | **Unsolved** - identical duplicate risk to FL-0015, just remote |
| Replay/redelivery | N/A - this is the mechanism *by which* redelivery is controlled, not a guarantee against needing to handle it |
| Duplicate source publication | **Unsolved** - out of scope entirely; a subscribe-side mechanism has no visibility into whether two Platform Event records represent one business operation |
| Temporary ServiceNow failure | Unsolved |
| Process restart | **The one real improvement** - server-side position survives local disk loss, and removes the need to build our own persistence (fixes FL-0017, not LL-0008/0009) |

### E. Additional mechanism found during investigation

Not one of the four requested candidates, but surfaced while re-reading
the proto for Candidate D: `ProducerEvent.id` - a third identity,
distinct from both `replay_id` and `Correlation_Id__c`. Not currently
used by this integration. It shares `Correlation_Id__c`'s fundamental
limitation: only as stable across retries as the publisher chooses to
make it, and no publishing contract has been specified. Doesn't change
the Section 2 analysis - if anything, it reinforces that business
identity is a publisher-contract problem, not a field-availability one.

---

## 5. Tradeoffs

- **A (target-side):** Would be the strongest guarantee *if* achievable,
  but this round's direct attempt to achieve it (with genuine admin
  access, not blocked by ADR 0004's least-privilege stance) did not
  succeed in three separate ways (FL-0018), and the concurrency
  experiment confirms the unconstrained failure mode is real and current
  (OB-0014). The most robust untested route (Import Set + coalesce)
  remains an architecture change, not a config tweak, and was not
  attempted this round.
- **B (lookup-before-create):** Smallest, fastest, reuses proven code -
  but a race-prone mitigation, not a guarantee, unless paired with A.
- **C (durable state):** Most complete and most platform-agnostic, but
  the largest net-new piece of infrastructure this project would need to
  build - and doesn't eliminate the checkpoint-ordering question, it sits
  alongside it.
- **D (`ManagedSubscribe`):** Solves a real, already-documented problem
  (FL-0017) but does not touch this investigation's actual question.
  Adopting it without also choosing A or C would look like progress while
  solving a different problem.

A and C are not mutually exclusive with B or D: B could be a cheap first
layer while A or C is built; D could be adopted later purely to address
FL-0017, independent of whichever of A/C is eventually chosen here.

---

## 6. Unresolved questions

- ~~Whether ServiceNow Table API `POST` responses are visible to an
  immediate subsequent `GET` (read-after-write consistency)~~ -
  **resolved this round:** yes, observed reliably in §3b's concurrency
  experiment (both newly-created records were immediately visible to an
  independent follow-up query).
- **New, and now the most load-bearing open question:** *why* did
  ServiceNow's admin-UI index-creation wizard accept a fully-configured
  unique-index request and return success-shaped responses three
  separate times without ever persisting a record (FL-0018)? Genuinely
  unknown - could be a licensing gate, an async job this session didn't
  wait for, or an instance quirk. This determines whether Candidate A
  is actually infeasible here or just not yet achieved.
- Whether Import Set + Transform Map coalesce is configurable in this
  instance - **still not attempted.** This round investigated `sys_index`
  instead (the mechanism actually surfaced by inspecting the schema
  directly), not Import Sets/Transform Maps; that documented pattern
  remains a completely separate, unverified path to the same goal.
- What upstream (Salesforce-side) publishing contract will actually
  govern `Correlation_Id__c` stability across retries in production -
  this project has only ever been its own publisher via test scripts; the
  real Salesforce automation that would trigger
  `DistributorOnboardingRequested` doesn't exist yet. A genuine open
  dependency, not just an untested detail, and not specific to
  ServiceNow - any correlation-keyed approach (A, B, or C) needs it.
- Whether `ManagedSubscribe`'s open-beta status and support posture are
  acceptable for this project's purposes - not researched beyond the
  proto's own comments.
- For Candidate C, what minimum durable-storage mechanism would actually
  be appropriate at this project's scale - not investigated, since it's
  an implementation detail, not an architecture choice.

---

## 7. Recommendation: smallest next experiment to discriminate between the strongest candidates

**Still not selecting an architecture.** This round's evidence shifted
the picture - it did not fully discriminate between A and C. The
concurrency experiment (§3b) conclusively shows the unconstrained
configuration fails, which is real, useful evidence, but it does not
prove ServiceNow *can't* enforce this - only that this session's
attempts to make it enforce it, across three well-formed tries with
genuine admin access, didn't work, for a reason that was never
explained (FL-0018). Writing an ADR for Candidate C now would mean
choosing it mainly by elimination, on the strength of one unresolved,
instance-specific UI obstacle rather than a confirmed platform
limitation. Per the same discipline this investigation has applied
throughout, that gap is not yet enough to justify a decision.

**Recommended smallest next experiment:** resolve *why* §3a's index
creation attempts didn't persist, before doing anything larger -
concretely, either (a) consult ServiceNow's own support/documentation
channel for this specific symptom (a `200`-status "Database Indexes"
wizard submission that never results in a persisted `sys_index` record),
or (b) retry the same steps after allowing for a longer wait (in case
it's an asynchronous background job rather than a synchronous rejection)
and checking ServiceNow's system logs (`syslog`) for any server-side
trace of the attempt that the UI itself didn't surface. This is smaller
than either remaining larger step - prototyping Candidate C's durable
store, or attempting the separate, unverified Import Set + coalesce path
- and its answer is the one thing that would most directly resolve
whether Candidate A remains a live option at all, rather than continuing
to weigh it against C on incomplete information.

---

## Explicitly out of scope for this document

No idempotency, retries, durable processing state, `ManagedSubscribe`, or
other reliability mechanism has been implemented here. No ADR has been
written - the evidence does not yet single out one candidate, and per
this investigation's own instructions, manufacturing a decision ahead of
that evidence would violate the same discipline this project has applied
throughout (`CLAUDE.md`: "Do not manufacture alternatives merely to make
an ADR appear sophisticated").

This round added two artifacts that are investigation tooling, not
implementation: the custom field `u_gv_business_operation_id` on
ServiceNow's Incident table (created live in the ServiceNow instance,
per this round's explicit permission to do so for the experiment - not
referenced by any runtime code, e.g. `incidentAdapter.ts`), and
`scripts/test-servicenow-concurrent-idempotency.ts` (a standalone
experiment script, following this project's existing pattern of
investigation-only scripts like `detect-unprocessed-events.ts` - not
wired into the subscriber or any runtime path). The Salesforce
subscriber (`pubsubClient.ts`, `checkpoint.ts`) was not modified.
