# Architecture Spike: Guaranteeing Exactly-One Incident per Business Event

**Status:** SPIKE — investigation only. No decision made, no ADR written.
**Date:** 2026-09-15
**Related:** `docs/devex/friction-log.md` FL-0011–FL-0017,
`docs/devex/observations.md` OB-0007–OB-0012,
`docs/devex/lessons-learned.md` LL-0005–LL-0011,
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
  uniqueness constraint could be added - **blocked**: the dedicated
  `itil`-role integration user received "Insufficient rights to query
  records." Schema-level changes would need privileges beyond what
  ADR 0004 deliberately granted this integration. This is itself a
  platform-access finding, not a workaround target.
- Import Sets + Transform Maps support "coalesce" fields, a documented
  ServiceNow pattern for upsert-by-arbitrary-key on import - a real,
  known capability, but **not independently verified against this
  instance**, and switching from the Table API to Import Sets is an
  architecture change (different endpoint, asynchronous transform,
  admin-level setup), not a config tweak.

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
support idempotent creation keyed on an external/correlation identifier.
See Platform Findings above for the concrete results.

**Failure-mode analysis:**

| Failure mode | Result |
|---|---|
| Crash before target side effect | Safe - nothing happened yet |
| Crash after target side effect, before checkpoint | **Solved**, if a real uniqueness mechanism (e.g. Import Set coalesce) exists - a retried create would be rejected/coalesced by ServiceNow itself |
| Replay/redelivery | **Solved**, same reasoning |
| Duplicate source publication (same `correlationId`) | **Solved** - this is exactly the case a correlation-keyed constraint is designed to catch |
| Temporary ServiceNow failure | Unaddressed - orthogonal |
| Process restart | **Solved**, same as redelivery |

Notably, if implemented, this candidate would let the integration keep
today's *simpler* checkpoint ordering (checkpoint after ServiceNow)
safely - the duplicate-prevention work moves entirely to ServiceNow, and
FL-0015's failure mode stops mattering.

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

- **A (target-side):** Strongest guarantee if achievable, but requires
  ServiceNow admin work outside this integration's current privileges -
  the deliberately least-privileged `itil` user (ADR 0004) can't even
  read `sys_dictionary`. The most robust route (Import Set + coalesce) is
  an architecture change, not a config tweak.
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

- Whether ServiceNow Table API `POST` responses are visible to an
  immediate subsequent `GET` (read-after-write consistency) - determines
  how large Candidate B's race window really is. Not tested.
- Whether Import Set + Transform Map coalesce is configurable with this
  integration's current privileges, or would require a privilege change
  weighed against ADR 0004's least-privilege stance. Blocked by the
  `sys_dictionary` permission finding above; not resolved.
- What upstream (Salesforce-side) publishing contract will actually
  govern `Correlation_Id__c` stability across retries in production -
  this project has only ever been its own publisher via test scripts; the
  real Salesforce automation that would trigger
  `DistributorOnboardingRequested` doesn't exist yet. A genuine open
  dependency, not just an untested detail.
- Whether `ManagedSubscribe`'s open-beta status and support posture are
  acceptable for this project's purposes - not researched beyond the
  proto's own comments.
- For Candidate C, what minimum durable-storage mechanism would actually
  be appropriate at this project's scale - not investigated, since it's
  an implementation detail, not an architecture choice.

---

## 7. Recommendation: smallest next experiment to discriminate between the strongest candidates

Not selecting an architecture. Candidates A and C both fully address
every demonstrated failure; B is a cheap partial mitigation; D is
orthogonal to this problem entirely. The question actually blocking a
choice between A and C is the one this investigation could not resolve
itself: **does this integration's current (or a reasonably adjusted)
ServiceNow privilege level realistically support a target-side uniqueness
guarantee, or is integration-owned durable state (C) the only fully
achievable option without renegotiating ADR 0004's access model?**

**Recommended smallest next experiment:** investigate, without
implementing, whether Import Set + Transform Map coalesce (or any other
ServiceNow-native uniqueness mechanism) is configurable by a user with
the same or only slightly elevated privileges as the current `itil`-role
integration user - concretely, have someone with ServiceNow admin access
check `sys_dictionary` for the Incident table (or a candidate staging
table) and report what unique-constraint options actually exist, rather
than continuing to reason about it from documentation alone. This is
smaller than prototyping either full candidate, and its answer directly
determines whether the eventual decision is "A vs. C" or simply "C" by
elimination.

---

## Explicitly out of scope for this document

No idempotency, retries, durable processing state, `ManagedSubscribe`, or
other reliability mechanism has been implemented here. No ADR has been
written - the evidence does not yet single out one candidate, and per
this investigation's own instructions, manufacturing a decision ahead of
that evidence would violate the same discipline this project has applied
throughout (`CLAUDE.md`: "Do not manufacture alternatives merely to make
an ADR appear sophisticated").
