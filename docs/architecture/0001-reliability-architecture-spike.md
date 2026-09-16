# Architecture Spike: Guaranteeing Exactly-One Incident per Business Event

**Status:** SPIKE — investigation only. No decision made, no ADR written.
**Date:** originally 2026-09-15; updated across eight follow-up rounds
spanning 2026-09-15–16 as this document's own open questions were
tested one at a time rather than reasoned about. In order: (1) the
initial spike (§1–§7 as originally written); (2) a ServiceNow
concurrency test proving the unconstrained failure mode is real
(§3b); (3) resolving two false leads behind the admin-UI index-creation
mystery (§3a's first "Follow-up"); (4) a durable-state prototype tested
under matched concurrency (§4 "C-prototype"); (5) identifying the raw
`sys_index` path's root cause with certainty and narrowing the
supported wizard's still-unexplained failure (§3a's second "Follow-up");
(6) testing whether a stale durable record can be safely reclaimed
(§4 "C-reclaim") and whether target reconciliation closes the gap
reclaim alone couldn't (§4 "C-reconciliation"); (7) reproducing the
slow-original-owner race with genuinely independent processes and
confirming it unsafe (§4 "C-slow-owner-race"); (8) checking whether any
ServiceNow API provides a target-enforced conditional-write mechanism
that could close that gap - confirmed no (§3c). Full round-by-round
detail lives in the DevEx journal entries cited throughout, not
repeated here.
**Related:** `docs/devex/friction-log.md` FL-0011–FL-0021,
`docs/devex/observations.md` OB-0007–OB-0023,
`docs/devex/lessons-learned.md` LL-0005–LL-0018,
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

**Follow-up, same day (FL-0018, OB-0016): two real causes found and
fixed; the gap above remains.** Went back specifically to resolve this
section's open question. Found and fixed two genuine causes, in order:

1. **`security_admin` was assigned to the admin account but not
   *elevated* for the session** - a real ServiceNow distinction this
   spike hadn't previously accounted for. `g_user.hasRole('security_admin')`
   returning `true` was misleading; elevated-privilege roles must be
   separately activated per-session via the platform's own "Elevate
   role" UI action. Elevating it (confirmed via the account's own
   avatar `aria-label` changing to include `security_admin`) changed
   real behavior: the identical wizard submission went from a silent
   `200` with no feedback to a specific, correct validation error -
   *"Requested fields (u_gv_business_operation_id) contain duplicate
   values."*
2. **That error was correct.** §3b's own concurrency experiment had left
   a genuine duplicate value in place (`INC0010009`/`INC0010010`).
   Cleared it on one record and verified independently.

**With both fixed, the index still does not persist**, checked four
independent ways after a clean submission with no error path taken:
`sys_index` (filtered query, still zero rows after a 30-second wait),
`staged_alter_history` (ServiceNow's own schema-alteration tracking
table - completely empty, for every table, not just this one),
`sys_email` (no completion notification, despite the wizard's own
embedded UI text describing one: *"the system will send you a
confirmation email"*), and `sys_dictionary` (still no native uniqueness
field). `sys_index_suggestion`, a separate automatic slow-query-advisor
feature discovered while searching for an alternative tracking table,
was also checked and is unrelated (empty, and not the mechanism a
manually-requested index goes through).

This is a stronger negative result than the original finding above, not
a repeat of it: the two most plausible explanations for the gap
(privilege, dirty data) were directly tested and eliminated, narrowing
what's actually going on without resolving it. Full account: FL-0018,
OB-0016. Because no enforcement could be independently verified as
active, §3b's concurrency experiment was **not** rerun under an
"enforced" premise - see §6 and §7 for how this changes the recommended
next step.

**Second follow-up, next day (FL-0018, OB-0019): the raw path's root
cause is now certain; the wizard's failure is narrowed, not yet
explained.** A bounded, final investigation of this candidate, with the
explicit constraint of not building any workaround merely to force a
result.

- **Read the `sys_index` table's own `create` Access Control directly**
  (as admin, with `security_admin` freshly re-elevated for this fresh
  session and reverified active via the account's own avatar label -
  elevation does not persist across browser sessions). `admin_overrides`
  is `false`, and the one required role is `nobody` - ServiceNow's
  standard convention for a role no user can hold. This is a
  **deliberate, universal platform restriction**, authored by `system`
  in 2015, not a permissions gap - it fully explains every "Invalid
  insert" seen against the raw form, in this round and the original one.
  Not fixable by any interactive user's privilege, ever.
- **Retested the wizard three further ways**, isolating every remaining
  plausible cause: a *non-unique* index on the same field (ruling out
  the uniqueness flag itself as the trigger - it wasn't, the plain index
  didn't persist either); a unique index on the same field with data
  reconfirmed clean; and a unique index on a **brand-new, empty,
  single-column custom table** created specifically for this test
  (ruling out `incident`'s size, its `task` inheritance, and its
  specific field type as the cause). All three: `200`/`200`, no error,
  no native dialog triggered (confirmed via stubs, consistent with this
  project's standing rule against automating past a real confirm/alert),
  zero persisted record.
- **Net effect:** privilege, dirty data, table complexity, and field
  type are now each individually *ruled out* by direct test, not merely
  unconsidered - across five total attempts spanning two sessions. The
  raw path's block is fully explained (a wall, not a gap); the wizard's
  failure - on a supported path apparently built to route around that
  same wall - remains genuinely unexplained, most plausibly an
  edition/plugin-level restriction specific to this developer instance,
  not observable from a browser session.
- Import Set + Transform Map coalesce (the other candidate mechanism
  named in this round's instructions) was **not** hands-on tested, to
  keep this round bounded - reasoned about instead: ServiceNow's
  documented coalesce behavior is implemented as a query-then-write
  pattern against the target table, not a documented database-level
  atomic upsert, so its concurrency guarantee (if any) would likely
  match Candidate B's rather than provide something new - unless backed
  by a real unique index, which loops back to the same unresolved
  mechanism. Flagged explicitly as unverified reasoning, not a result.

No enforceable constraint was configured, so the concurrency experiment
was **not** rerun a third time under a claimed "enforced" premise, and
no workaround (business rule, application-level lock, or
lookup-before-create presented as equivalent) was substituted. Full
account: FL-0018's second follow-up, OB-0019.

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

### 3c. Conditional-write capability investigation (bounded follow-up to OB-0022)

OB-0022 confirmed that integration-local ownership (Candidate C's
`acquire`/`reclaim`) cannot, by itself, prevent a stale-but-still-alive
worker from producing a real ServiceNow side effect after ownership has
transferred - closing that gap for real requires the *target* to
participate in the decision. This round asked one narrower question
than FL-0018's schema-level investigation: does ServiceNow's Table API,
or another directly usable ServiceNow record-creation API, provide any
target-enforced conditional-create mechanism - not a client-side
`GET`-then-`POST` (already rejected, OB-0014) and not a client-side
fencing check before `POST` (already rejected, OB-0022) - that could
close it?

**Documentation checked first.** ServiceNow's own Table API reference
(Washington DC release) documents the exact headers each operation
(`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) accepts. None of the five
document `ETag`, `If-Match`, `If-None-Match`, or any conditional/
precondition mechanism - not specific to `POST`, absent from the entire
API surface.

**Verified empirically, not trusted from documentation alone**
(`scripts/test-servicenow-conditional-create.ts`, itil-role credentials,
no privilege change): neither list nor single-record `GET` returns an
`ETag` or `Last-Modified` header (no version identifier exists for a
conditional request to reference); a `POST` sent with
`If-None-Match: *` succeeded normally, the header silently ignored;
**two concurrent `POST`s for the same business-operation ID, both
carrying `If-None-Match: *`, both succeeded** - independently verified,
2 Incidents resulted, confirming the textbook HTTP conditional-create
pattern provides zero protection here; `PUT` to a never-used `sys_id`
returned `404`, confirming `PUT` is update-only with no upsert path to
attach a conditional header to.

**Import Set + Transform Map coalesce** (the other candidate mechanism
named in FL-0018's second follow-up, reasoned about but not hands-on
tested there either) was checked against public ServiceNow community
reports rather than built this round, to stay bounded: independent
reports describe coalesce producing duplicate records under
concurrent/repeated REST submission, consistent with the standing
reasoning that it performs an existence check and a write as two
separate steps, not one atomic operation.

**GraphQL mutations** were checked and are not a ready-made mechanism -
ServiceNow's GraphQL framework requires a custom *Scripted resolver*
(developer-written `GlideRecord` code) to implement record creation at
all. No built-in conditional-create or optimistic-concurrency primitive
exists to test without first writing new ServiceNow-side code -
implementation, explicitly out of scope this round.

**Conclusion: confirmed no**, for every mechanism reachable without
writing new ServiceNow server-side code. This is not "not yet found" -
it is documented as absent across the Table API's entire surface and
directly confirmed absent by testing the one candidate mechanism that
would have required no new ServiceNow-side code to try. Full account:
OB-0023, LL-0018.

---

## 4. Candidate approaches

### A. Target-side idempotency (ServiceNow enforces it)

**What was investigated:** whether ServiceNow can enforce or naturally
support idempotent creation keyed on an external/correlation identifier
- including a direct concurrency experiment against the unconstrained
field, and five separate attempts (via real, verified-elevated admin
access) across two sessions to actually create a platform-enforced
unique index, plus reading the platform's own Access Control governing
manual index creation directly. See §3a/§3b for the concrete results.

**Failure-mode analysis:**

| Failure mode | Result |
|---|---|
| Crash before target side effect | Safe - nothing happened yet |
| Crash after target side effect, before checkpoint | **Still unproven, not solved - now for a more specific reason.** Would require a real uniqueness mechanism (e.g. a `sys_index` unique constraint). The manual-creation path is now confirmed permanently blocked by a platform ACL (role `nobody`, `admin_overrides=false` - OB-0019); the supported wizard path has failed on every one of five separate attempts, with privilege, dirty data, table complexity, and field type each individually ruled out as the cause. Confirmed *without* an enforced mechanism, two concurrent creates both succeed (§3b) |
| Replay/redelivery | Same as above - depends entirely on the unproven enforcement mechanism |
| Duplicate source publication (same `correlationId`) | **Directly tested and failed to hold**, for the current (unconstrained) configuration: two concurrent requests for the same business-operation ID both created an Incident (OB-0014) |
| Temporary ServiceNow failure | Unaddressed - orthogonal |
| Process restart | Same dependency as redelivery, above |

If a real enforcement mechanism could be made to work, this candidate
would still let the integration keep today's *simpler* checkpoint
ordering (checkpoint after ServiceNow) safely - the duplicate-prevention
work would move entirely to ServiceNow, and FL-0015's failure mode would
stop mattering. That conclusion still carries the same bigger "if" the
prior round left it with: the enforcement mechanism itself is the open
question, not a detail to fill in later - and this round has ruled out
the plausible explanations for the wizard's failure without resolving
what remains.

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
| Crash before target side effect | **Confirmed solved with target reconciliation**, for a genuine crash - reclaim + a ServiceNow lookup by business-operation ID correctly found nothing and created exactly once (OB-0021, Case 1). **Confirmed UNSOLVED if the "crash" is actually a slow but live worker** (see C-slow-owner-race below) - reconciliation cannot distinguish "truly abandoned" from "still running," and a real duplicate results, deterministically (OB-0022) |
| Crash after target side effect, before checkpoint | **Confirmed solved with target reconciliation**, for a genuine crash. Reclaim + reconciliation found the real, already-existing Incident and recorded it as completion instead of creating a duplicate, verified by matching `sys_id` (OB-0021, Case 2) |
| Replay/redelivery | Solved by the same mechanism as the two rows above, for a genuine crash; unsolved for the slow-owner variant, same as the first row |
| Duplicate source publication | **Confirmed solved** (OB-0017) - keyed on business identity, not replay position, matching Candidate A's intended coverage, and unlike Candidate A this was verified working, not just designed |
| Temporary ServiceNow failure | Could be extended to support real retry-with-backoff, which no other candidate addresses - but designing that further is out of this investigation's scope |
| Process restart | Same as "crash before/after target side effect" above - solved for a genuine crash, confirmed unsolved for the slow-owner variant (OB-0022) |

Most complete and most platform-agnostic candidate on paper, but the
largest to build - real durable storage is net-new infrastructure for
this project, and it doesn't remove the need to also decide checkpoint
ordering; it solves the business-idempotency problem independently of,
not instead of, that decision.

#### C-prototype. Investigation-only durable-state prototype (this round's follow-up)

With ServiceNow's own target-side uniqueness left unverified (FL-0018,
OB-0016), built the smallest possible prototype of this candidate to
test it under the same adversarial concurrency used against ServiceNow
in the earlier round (§3b) - deliberately **not** wired into `src/`,
per this round's explicit "investigation only" instruction.

`services/integration-service/scripts/lib/idempotencyStore.ts` uses
`node:sqlite` (built into Node 22, zero new dependency) with a
`PRIMARY KEY` constraint on the business-operation ID as the atomic
gate. Every caller attempts an `INSERT` directly - the database
engine's constraint, not a prior `SELECT`, decides the single winner,
deliberately avoiding Candidate B's lookup-then-create race.

**Two experiments, two results:**

- **`scripts/test-durable-state-concurrent-idempotency.ts` (OB-0017):**
  five iterations of two genuinely concurrent attempts (`Promise.all`)
  per fresh business-operation ID. **5/5 clean** - exactly one winner,
  confirmed the loser never called ServiceNow at all (not merely that
  it lost a race at ServiceNow's end, as in §3b), exactly one Incident
  independently confirmed each time. This is a stronger result in kind
  than anything achieved for Candidate A - the invariant held by
  construction, using infrastructure this project fully controls, with
  none of the unexplained platform opacity that stalled FL-0018.
  Honesty note carried into OB-0017 itself: because `acquire()` is
  synchronous and JS is single-threaded, the same caller won all five
  trials deterministically - this tests whether the primitive
  structurally enforces the invariant regardless of ordering, not
  whether it survives a genuine timing race the way §3b's HTTP-based
  test did. Both are legitimate, different senses of "concurrent."
- **`scripts/test-durable-state-crash-gap.ts` (OB-0018):** simulates a
  crash between acquiring ownership and calling ServiceNow (process
  close/reopen against the same on-disk store, not just a JS variable
  check), then simulates a redelivery attempt. **Confirmed the
  predicted failure mode:** the business operation becomes permanently,
  silently unrecoverable through this path - zero Incidents ever,
  every future redelivery attempt quietly blocked, indistinguishable
  from a legitimate in-flight request, no error, no log trail. This is
  the same lesson as LL-0009's checkpoint-ordering finding
  (FL-0016/OB-0010), now confirmed to apply to a durable-state gate in
  front of ServiceNow, not just a checkpoint in front of it.

**Net effect on this candidate's status:** the duplicate-prevention
half is now demonstrated, not just designed. The crash-gap half is
demonstrated to be a real, necessary problem to solve, not a
theoretical edge case - "Solved" in the table above has been
downgraded from the original design sketch's optimism to "confirmed
ambiguous" for exactly the cases that matter most. A real
implementation still needs a specific answer (e.g. a staleness timeout
plus explicit reclaim path) that was deliberately not designed or built
here, and that answer would need its own testing (a reclaim that fires
too eagerly reintroduces OB-0014's duplicate; one that never fires
reproduces OB-0018's loss).

#### C-reclaim. Can a stale record be safely reclaimed? (this round's follow-up)

Direct, bounded follow-up to OB-0018, testing the exact question the
prior round left open, without building a general lease/heartbeat
framework. Extended `idempotencyStore.ts` with exactly one function,
`reclaim()`: an atomic, conditional `UPDATE ... WHERE status='in_flight'
AND acquired_at < cutoff` - the same "constraint decides, not a prior
read" principle as `acquire()`, applied to reclaiming. No lease
ownership token, no heartbeat, no retry counter - the minimum state
needed for the experiment.

`scripts/test-durable-state-reclaim-ambiguity.ts` produced two crashed
operations that reach **the identical durable-record shape**
(`status=in_flight`, no incident recorded) via two different real
paths - Case 1 crashes before ever calling ServiceNow; Case 2 calls
ServiceNow for real (a genuine Incident is created) and *then* crashes
before recording completion - and printed both records side by side to
confirm they are indistinguishable before any reclaim runs.

After a real elapsed wait (not simulated), both records were reclaimed
and retried identically, with the result independently verified against
ServiceNow:

- **Case 1: exactly 1 Incident.** A genuinely abandoned operation was
  recovered correctly, exactly once (OB-0020).
- **Case 2: exactly 2 Incidents** - the original real one plus a
  duplicate from the naive retry. **Naive staleness-based reclaim
  reintroduced OB-0014's duplicate failure exactly as hypothesized**
  (OB-0020).

**Answer to this section's question: elapsed time alone cannot safely
distinguish these two crash boundaries.** It can determine *that* an
operation has been abandoned; it cannot determine *whether* the
abandoned attempt already succeeded. The durable record as currently
modeled only ever answers the first question - `acquire()`/`in_flight`
records ownership, and only `markCompleted()` records that the external
effect happened, and that specific write is exactly what a crash in
this gap prevents, regardless of how the ownership half is designed
(LL-0015).

**Smallest additional evidence investigated (not implemented) to
resolve the ambiguity:** query ServiceNow directly by the
business-operation identifier as part of the reclaim path, before
deciding whether to call ServiceNow again - target reconciliation,
narrowed from the existing audit tool's "sweep everything periodically"
(`detect-unprocessed-events.ts`) down to "check this one ID at the
moment a reclaim is about to act on it." Reasoned through why this
doesn't reintroduce Candidate B's rejected race (`reclaim()`'s own
atomic guard already ensures only one caller can be mid-reclaim for a
given ID, so the reconciliation query isn't racing a concurrent
reclaimer - only checking a fact about the past) - with one named,
unresolved edge case: a "crash" that is actually just a slow in-flight
request could still complete and call `markCompleted()` *after* the
reconciliation query already ran and found nothing. This reasoning is
recorded (LL-0015) as the next candidate mechanism to test, not
validated, and not built into `idempotencyStore.ts` or anywhere else
this round, per instruction.

#### C-reconciliation. Does target reconciliation actually close the gap? (this round's follow-up)

Direct, bounded test of LL-0015's reasoned-but-unbuilt proposal -
nothing more. `scripts/test-durable-state-reclaim-reconciliation.ts`
adds a minimal `reconcileAndComplete` orchestration *in the script*, not
in `idempotencyStore.ts` - query ServiceNow by business-operation ID
after a successful reclaim; found means record that Incident as the
completion; absent means create, then record. Reconciliation is used
only on this reclaim path, never on normal first-processing - `acquire()`
remains the sole concurrency gate for new work, and this does not
reopen Candidate B's already-rejected lookup-before-create question.

Repeated OB-0020's exact two cases, then extended the same experiment
with a third the fix itself invites scrutiny of - concurrent reclaim:

- **Case 1 (crash before ServiceNow): 1 Incident, independently
  verified.** Reconciliation found nothing and created exactly once -
  unchanged from OB-0020's Case 1, as expected.
- **Case 2 (crash after ServiceNow succeeds): 1 Incident, independently
  verified as the *original* `sys_id`, not a new one.** Reconciliation
  found the real Incident from before the simulated crash and recorded
  it as completion; no second create happened. This is the specific
  result OB-0020's naive reclaim could not produce (OB-0021).
- **Case 3 (two concurrent `reclaim()` attempts against the same stale
  record): exactly one winner, exactly one Incident, independently
  verified.** The same atomic "constraint decides" guarantee `acquire()`
  already had (OB-0017) extends to the reclaim path too - shown, not
  assumed (OB-0021).

**Stated plainly, against the four properties this round set out to
check:**

- Crash before the ServiceNow side effect - **SOLVED.**
- Crash after the ServiceNow side effect, before local completion -
  **SOLVED.**
- Concurrent reclaim ownership - **SOLVED.**
- The slow-original-worker race (Worker A's ServiceNow call still
  genuinely executing when Worker B considers A stale, reclaims,
  reconciles, finds nothing, and acts, followed by A completing) -
  **NOT ESTABLISHED, deliberately.** This script's own structure - one
  sequential process, each phase's store handle closed before the next
  opens - cannot produce a scenario where an "abandoned" worker is
  actually still running. Nothing here proves this race is safe,
  unsafe, or even reachable; it is restated as open, not quietly
  dropped (LL-0016).

Three of four properties this candidate needed to answer are now
answered by direct experiment, independently verified against
ServiceNow rather than trusted from local state - a materially stronger
position than the prior round left this candidate in. The fourth -
genuine concurrent recovery - is the one property left, and is now the
single most load-bearing open question for Candidate C (see §7).

#### C-slow-owner-race. Does reconciliation survive a genuinely concurrent slow owner? (this round's follow-up)

Direct reproduction of the one property C-reconciliation left open -
built with genuinely independent processes this time, not a
single-process simulation, because the question itself (is the
original owner still alive and working?) cannot be honestly tested any
other way.

`scripts/lib/slowWorkerA.ts` and `scripts/lib/slowWorkerB.ts` run as
separate OS processes (`child_process.spawn`, each its own Node
runtime), coordinated by `scripts/test-durable-state-slow-worker-race.ts`,
both operating against the same on-disk store and the same real
ServiceNow instance concurrently. Worker A ("original owner") acquires,
waits 6 seconds (simulating real in-progress work, not a crash), then
calls ServiceNow for real. Worker B ("recovery owner") starts ~300ms
later, waits 2.5 seconds (past the 2-second staleness threshold),
reclaims, reconciles (the unmodified C-reconciliation mechanism), finds
nothing (because Worker A hasn't called ServiceNow yet), and creates
its own Incident.

**Result: confirmed, deterministically, 3/3 iterations** (OB-0022). Two
real Incidents exist in ServiceNow for the same business-operation ID
every time, independently verified. The wide, fixed timing margin (six
times the staleness threshold) means this is not a lucky-scheduling
artifact - the same outcome occurred on every run with no variance.
Both Incidents were left in place each time; no deduplication or
workaround was added to make the experiment "pass."

**A sharper finding than "a duplicate exists":** the *local* durable
record afterward shows only one Incident - whichever worker's
`markCompleted()` ran last (Worker A, being slower). Neither worker
checks whether it still owns the record before completing - there is no
fencing token - so the local record isn't just incomplete (as in
OB-0018's honest "still `in_flight`"), it is **actively wrong**: it
reports "completed" with one Incident number while ServiceNow holds
two. Nothing about the mechanism itself would ever surface this
discrepancy.

**Why this can't be closed by tuning the local mechanism further:** the
question "is the original owner dead?" is unanswerable from elapsed
time alone regardless of the threshold chosen - a shorter threshold
reclaims live workers more often, a longer one leaves real crashes
unrecovered longer, and neither closes the gap, because it isn't a
tuning problem. Closing it for real requires either the original
worker to be stopped from acting after being fenced (which itself can
only narrow, never provably close, the window - a worker paused between
checking its fencing status and making the actual network call can
still slip through, the same structural problem lease-based distributed
locking schemes have generally), or the *target* refusing the second
write. The second option is exactly Candidate A's still-open question
(FL-0018): can ServiceNow enforce uniqueness on this identifier at all.
**Candidate C's remaining gap and Candidate A's open question turn out
to be the same question, asked from two different layers** - not fully
independent alternatives the way the original spike framed them
(LL-0017).

**That target-side question was then asked directly, not left as
inference - see §3c.** Answer: confirmed no target-enforced
conditional-write mechanism exists that's reachable without writing new
ServiceNow server-side code (OB-0023, LL-0018). Candidate C's
slow-owner gap remains open; the next question is no longer "which
ServiceNow API feature closes it" but an architecture-level fork
(§3c, §7).

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
  but repeated direct attempts to achieve it (with genuine, verified-
  elevated admin access, not blocked by ADR 0004's least-privilege
  stance, and with the one real data problem the platform itself flagged
  fixed) did not succeed across five separate attempts spanning two
  sessions (FL-0018, OB-0016, OB-0019), and the concurrency experiment
  confirms the unconstrained failure mode is real and current (OB-0014).
  One path is now confirmed permanently closed by platform design (a
  `create` ACL on `sys_index` requiring an unassignable role); the
  other (the supported wizard) has failed with privilege, data, table
  complexity, and field type all ruled out as the cause, but without a
  definitive "not possible" answer either. **A narrower, platform-wide
  question was then checked directly: does ServiceNow's Table API
  support any conditional-write precondition at all, independent of the
  schema-level index question? Confirmed no, by official documentation
  and direct test (OB-0023)** - closing off the one path (an
  `If-None-Match`-style create) that wouldn't have required writing new
  ServiceNow server-side code. Import Set + coalesce and GraphQL
  mutations were also checked and found not to help either, without
  writing new server-side code (OB-0023).
- **B (lookup-before-create):** Smallest, fastest, reuses proven code -
  but a race-prone mitigation, not a guarantee, unless paired with A.
- **C (durable state):** Most complete and most platform-agnostic on
  paper, and the only candidate with a working prototype behind it
  (OB-0017: 5/5 clean concurrent trials, using infrastructure this
  project fully controls, zero new dependency). Still the largest
  net-new piece of infrastructure this project would need to build for
  real. OB-0018 confirmed a serious failure mode - permanent silent loss
  on a crash between acquiring ownership and calling ServiceNow - and a
  bare staleness-based reclaim (OB-0020) was confirmed unsafe on its own
  for exactly that reason. Target reconciliation (querying ServiceNow by
  business-operation ID during reclaim) was then built and tested, and
  closed both reproduced crash boundaries and concurrent reclaim
  (OB-0021). **Tested against a genuinely concurrent slow-owner race
  (two real processes, not a simulation) and confirmed unsafe,
  deterministically, 3/3 iterations** (OB-0022) - and this specific gap
  cannot be closed by tuning the local mechanism further; closing it for
  real converges on the same target-side capability Candidate A has been
  unable to establish (LL-0017), **now confirmed unavailable through any
  standard, non-custom-scripted ServiceNow API (OB-0023).** Doesn't
  eliminate the checkpoint-ordering question either, it sits alongside
  it.
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
- ~~Whether the raw `sys_index` manual-insert path is blocked by a
  fixable permissions gap or something more fundamental~~ - **resolved:**
  its `create` Access Control requires role `nobody` with
  `admin_overrides=false` (OB-0019) - a deliberate, universal platform
  restriction, confirmed by reading the ACL directly, not fixable by any
  interactive user's privilege.
- **Still the most load-bearing open question, narrowed twice now, not
  yet resolved:** *why* does ServiceNow's supported "Database Indexes"
  wizard accept a fully-configured index request and return
  success-shaped responses without ever persisting a record, on a path
  that (unlike raw manual insert) isn't blocked by the ACL above? Two
  follow-ups (FL-0018/OB-0016, then FL-0018's second follow-up/OB-0019)
  have now directly tested and eliminated four plausible explanations in
  turn - `security_admin` not being elevated, duplicate data in the
  target column, the uniqueness flag itself, and table
  complexity/field type (tested on a brand-new empty custom table) -
  and the gap remained after eliminating all four. What remains
  genuinely unknown is whether this is a licensing/edition gate specific
  to this developer instance, a code path this particular wizard doesn't
  actually reach, or something this browser session simply cannot
  observe (e.g. a server-side log only visible to ServiceNow's own
  support tooling). This determines whether Candidate A is actually
  infeasible here or just not yet achieved - and is now past what
  further UI-only investigation can resolve (see §7).
- ~~Whether Import Set + Transform Map coalesce is configurable in this
  instance and provides an atomic upsert~~ - **still not hands-on
  attempted in this instance**, by deliberate choice to keep each
  investigation round bounded, but the reasoning is no longer
  unverified: independent public ServiceNow community reports describe
  coalesce producing duplicate records under concurrent/repeated REST
  submission, consistent with the standing reasoning that it performs
  an existence check and a write as two separate steps (OB-0023). Not a
  hands-on test of this specific instance, but no longer purely
  speculative either.
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
- ~~For Candidate C, what minimum durable-storage mechanism would
  actually be appropriate at this project's scale~~ - **partially
  answered this round:** `node:sqlite` with a `PRIMARY KEY` constraint
  is sufficient to demonstrate the core atomicity mechanism (OB-0017),
  with zero new dependency. Whether it (vs. a real external datastore)
  is appropriate for a production implementation, not just a prototype,
  is still an implementation detail deferred past this investigation.
- ~~What staleness/reclaim policy would correctly resolve OB-0018's
  crash-gap failure mode without reintroducing OB-0014's
  duplicate-on-race failure mode?~~ - **answered this round, negatively:**
  a bare staleness-based policy cannot do this - it correctly recovers
  a genuinely abandoned operation but reintroduces the duplicate whenever
  the crash happened after ServiceNow already succeeded, because elapsed
  time cannot tell the two cases apart from the durable record alone
  (OB-0020, LL-0015). The question is no longer "what policy would
  work" in the abstract; it's now specifically whether a target-
  reconciliation check (querying ServiceNow by business-operation ID
  during reclaim) closes the gap - reasoned through, not tested
  (LL-0015).
- ~~Does target reconciliation during reclaim actually close the
  ambiguity OB-0020 demonstrated?~~ - **answered this round, positively,
  for the crash boundaries this project has reproduced:** yes - both
  crash-before-ServiceNow and crash-after-ServiceNow-before-completion
  are recovered correctly, independently verified, and concurrent
  reclaim attempts still produce exactly one winner and one Incident
  (OB-0021, LL-0016).
- ~~The slow-original-worker race (Worker A's ServiceNow call still
  genuinely executing when Worker B considers A stale, reclaims,
  reconciles, finds nothing, and acts, followed by A completing)~~ -
  **answered this round, with genuinely independent processes, not a
  simulation: confirmed unsafe, deterministically, 3/3 iterations**
  (OB-0022). Two real Incidents result every time, and the local
  durable record ends up actively wrong afterward (reporting one
  Incident while ServiceNow holds two), not merely incomplete. This
  gap cannot be closed by tuning the local reclaim/reconciliation
  mechanism further - see LL-0017 for why it structurally converges on
  the same open question as Candidate A.
- ~~Does ServiceNow's Table API expose any conditional-write mechanism
  usable on `POST` (create)~~ - **answered this round: confirmed no.**
  Documented as absent across the entire Table API surface (official
  reference documentation lists every header each operation accepts;
  none include `ETag`/`If-Match`/`If-None-Match`), and directly
  confirmed absent by test: `If-None-Match: *` on `POST` is silently
  ignored, two concurrent creates carrying it both still succeed, and
  `PUT` cannot create a not-yet-existing record at all (OB-0023,
  LL-0018). Import Set coalesce and GraphQL mutations were also checked
  and don't help without writing new ServiceNow server-side code
  (OB-0023).
- **New this round, replacing the one above:** is it worth this project
  writing new ServiceNow server-side code (a Business Rule or Scripted
  REST API performing the existence-check-and-insert inside one
  ServiceNow transaction, rather than as two separate HTTP round trips)
  to close the slow-owner gap - or should this project instead accept a
  nonzero-probability duplicate window and rely on the existing,
  validated audit tool (`detect-unprocessed-events.ts`, OB-0012) for
  detection rather than prevention? Not decided - an architecture-level
  fork this investigation has arrived at, not resolved (LL-0018, §7).

---

## 7. Recommendation: an architecture-level fork, not another incremental experiment

**Still not selecting an architecture, and explicitly not writing an ADR
this round - but this round changes the *kind* of next step available,
not just the evidence.** Four of five properties this investigation has
checked for Candidate C are confirmed protected by direct experiment:
concurrent initial processing (OB-0017), crash before the external side
effect (OB-0021), crash after the external side effect (OB-0021), and
concurrent reclaim (OB-0021). The fifth - a genuinely concurrent
slow-original-owner race - was reproduced for real, with independent
processes, and **confirmed unsafe**, not left open (OB-0022, 3/3
iterations). This round then asked directly whether ServiceNow's API
surface could close that gap, and the answer is **confirmed no**: no
conditional-write mechanism exists on the Table API (documented and
directly tested), Import Set coalesce doesn't provide one either
(corroborated, if not hands-on tested in this instance), and GraphQL
offers no built-in primitive to even test without first writing new
ServiceNow server-side code (OB-0023). Combined with FL-0018/OB-0019's
finding that the schema-level `unique_index` path is unexplained (not
merely difficult), **this project has now checked every standard,
non-custom-scripted door for ServiceNow-side write enforcement, and
found them all closed or unbuildable** (LL-0018).

That is a different kind of result than "the next experiment is
smaller." There is no smaller ServiceNow-API experiment left to run
without writing new server-side code - the remaining question is
whether to make that investment at all, which is an architecture-level
decision, not an incremental one.

**The fork this investigation has arrived at, neither branch decided or
built:**

1. **Write new ServiceNow server-side code** (a Business Rule or
   Scripted REST API performing the existence-check-and-insert inside
   one ServiceNow transaction, rather than as two separate HTTP round
   trips) to test whether the platform's own database transaction
   semantics can close the gap that no client-reachable API can. A
   real, different proposal from anything tested so far - and a real
   commitment (platform development, update sets, code living on the
   target instead of this repository) that hasn't been made yet.
2. **Accept a nonzero-probability duplicate window and lean on
   detection instead of prevention** - this project already has a
   validated audit tool (`detect-unprocessed-events.ts`, OB-0012) that
   correctly classifies `DUPLICATE`, not just `GAP`. Pairing a chosen
   candidate with that existing capability, rather than continuing to
   search for a prevention mechanism that may not exist without new
   platform code, is a legitimate position - not a concession, but a
   different tradeoff.

Candidate A remains exactly where the prior round left it, deliberately
untouched again this round per instruction: one path (raw manual
insert) conclusively closed by platform design; the other (the
supported wizard) unexplained after five ruled-out causes. **Opening a
real ServiceNow support case for that specific, well-characterized
symptom remains the smallest action left for Candidate A** - unchanged,
still not pursued further in-repo, outside this project's normal
engineering loop.

Both candidates' remaining blockers now point at the same underlying
fact: no target-side write-enforcement capability is available to this
project without writing new ServiceNow server-side code. Deciding
whether that investment is worth making - for either candidate - is the
next decision, not another experiment against the same set of doors
this round just finished checking.

---

## Explicitly out of scope for this document

No idempotency, retries, durable processing state, `ManagedSubscribe`, or
other reliability mechanism has been implemented here. No ADR has been
written - the evidence does not yet single out one candidate, and per
this investigation's own instructions, manufacturing a decision ahead of
that evidence would violate the same discipline this project has applied
throughout (`CLAUDE.md`: "Do not manufacture alternatives merely to make
an ADR appear sophisticated").

Across the eight follow-up rounds summarized at the top of this
document, every artifact added has been investigation tooling, never
implementation, and every one remains true today: **not referenced by
`src/`, not wired into the subscriber or `incidentAdapter.ts`, and not
the production implementation of any candidate even if that candidate
is eventually chosen.** Concretely, this investigation has added, live
in ServiceNow: the custom field `u_gv_business_operation_id` on
Incident, and a disposable custom table (`u_gv_index_test`) used to
isolate FL-0018's index-creation failure from Incident-table specifics
- both left in place as evidence trail, neither referenced by any
runtime code. In this repository: `scripts/test-servicenow-concurrent-idempotency.ts`;
`scripts/test-servicenow-conditional-create.ts` (this round's probe -
a standalone HTTP-header investigation, no store, no state, nothing to
wire in); `scripts/lib/idempotencyStore.ts` (the Candidate C prototype
- a `node:sqlite` file, gitignored, with exactly three functions added
across the whole investigation: `acquire`, `reclaim`, `markCompleted`,
plus `getRecord`, none touched this round) and its five experiment
scripts (`test-durable-state-concurrent-idempotency.ts`,
`test-durable-state-crash-gap.ts`, `test-durable-state-reclaim-ambiguity.ts`,
`test-durable-state-reclaim-reconciliation.ts`,
`test-durable-state-slow-worker-race.ts`, the last of which spawns
`scripts/lib/slowWorkerA.ts`/`slowWorkerB.ts` as genuinely separate
processes). The Salesforce subscriber (`pubsubClient.ts`,
`checkpoint.ts`) has never been modified by this investigation.

At every step where a fix suggested itself, this investigation
deliberately stopped short of building it, per each round's explicit
instruction: no lease/heartbeat/fencing framework, no generalized
recovery worker, no retry mechanism, no target-side uniqueness
mechanism, no local-only fencing token proposed as a substitute for
target-side enforcement, and this round, no new ServiceNow server-side
code (Business Rule or Scripted REST API) written to test the
architecture-level idea its own findings pointed to (§7) - that remains
a decision to make, not a mechanism to build yet. The slow-original-owner
race was analyzed, reproduced, and confirmed unsafe (OB-0022), and the
question of whether ServiceNow's API surface could close it was asked
directly and answered - confirmed no (OB-0023) - not built around,
patched, or quietly left unresolved once the tooling existed to
actually test it.
