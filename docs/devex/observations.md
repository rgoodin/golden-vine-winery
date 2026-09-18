# Observations

This is the raw developer experience log for the Salesforce → ServiceNow
integration (and later integrations). It captures what happened while
building the integration — not just friction, but anything worth remembering:
decisions in the moment, surprises, dead ends, things that worked well.

Per `CLAUDE.md`:

- We are intentionally beginning as Developer #1.
- The Golden Path must emerge from observed developer friction, not upfront
  design.
- Not every observation is friction — capture things that went smoothly too,
  so Phase 2 (Observation Review) has a complete picture.

See also `docs/devex/friction-log.md` (for friction specifically),
`docs/devex/decisions.md`, and `docs/devex/lessons-learned.md`.

## How to use this log

1. Capture observations as they happen, in roughly chronological order.
2. Keep entries short — this is a log, not a report. Expand into
   `friction-log.md` or an ADR in `docs/decisions/` if an entry turns out to
   be significant.
3. During Phase 2, classify entries into categories such as: environment
   setup, authentication, secrets, API discovery, schemas, testing, error
   handling, deployment, observability, documentation.

---

## Template

### OB-XXXX: <short title>

**Date:** YYYY-MM-DD
**Phase:** <current DevEx Dojo phase>
**Category:** <e.g. environment setup, authentication, API discovery, testing>

What happened? What was being attempted, and what was noticed?

---

### OB-0001: Scaffolded integration-service, deferred Pub/Sub implementation

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** environment setup / API discovery

Scaffolded `services/integration-service` (Node.js + TypeScript) with a
config loader, the canonical `DistributorOnboardingRequested` event type,
and a stub Salesforce Pub/Sub subscriber. Deliberately stopped short of
implementing real Salesforce authentication/subscription — see FL-0001 —
rather than guessing at an approach.

---

### OB-0002: Signed up for Developer Edition org, created External Client App

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** environment setup / authentication

Signed up for a Salesforce Developer Edition org (developer did this
directly — account creation and email verification aren't something an
agent should do on a developer's behalf). Generated a local self-signed
cert/key pair, created an External Client App with the JWT Bearer Flow
enabled and the cert uploaded, and retrieved the Consumer Key (after an
email identity-verification step). Wired these into
`services/integration-service/.env` (gitignored). See
`docs/decisions/0002-authentication-strategy.md` and FL-0002/FL-0003 for
what was learned along the way.

Still open: the integration service's Pub/Sub subscriber
(`src/salesforce/subscriber.ts`) remains a stub — having credentials
doesn't yet mean there's a gRPC/Avro client that uses them (FL-0001).

---

### OB-0003: Pre-authorized the External Client App for non-interactive JWT auth

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** authentication

The External Client App defaulted to Permitted Users =
"All users can self-authorize," which implies an interactive consent step —
not viable for a service with no human present. Changed it to "Admin
approved users are pre-authorized" and added the System Administrator
profile under Selected Profiles (Policies tab → OAuth Policies → Edit).
This was easy to miss: the profile picker only appears inline on the same
edit form once "Admin approved" is selected, not as a separate "Manage"
step, which wasn't obvious from the UI.

This closes out the Salesforce-side auth setup blocking FL-0001. What
remains for FL-0001 is purely code: the actual gRPC/Avro Pub/Sub client
implementation in `src/salesforce/subscriber.ts`.

---

### OB-0004: First end-to-end event proven — Phase 1's actual milestone

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** testing / milestone

Implemented the real Pub/Sub client (`src/salesforce/auth.ts`,
`pubsubClient.ts`, using Salesforce's official `pubsub_api.proto` -
`docs/decisions/0002-authentication-strategy.md`), created the
`Distributor_Onboarding_Requested__e` Platform Event with one field, wrote
a small test-event publisher (`scripts/publish-test-event.ts`), and ran the
whole thing against the real dev org:

    npm run dev                                  # subscriber connects, waits
    npm run publish-test-event -- "Acme Distribution Co"   # publishes via REST

The subscriber logged the received event in real time, with the real
`Distributor_Name__c` value, `CreatedDate`, `CreatedById`, and `replayId`.

Two small mismatches were caught and fixed along the way: the JWT `aud`
claim (FL-0005) and the Platform Event's actual (underscored) API name
vs. the assumed PascalCase name (FL-0006).

This is `CLAUDE.md`'s stated first milestone for the "Developer #1"
experiment (minus the ServiceNow leg, which doesn't exist yet): a
realistic Salesforce event reaching the integration layer, with the
experience documented along the way.

---

### OB-0005: Expanded Platform Event to full canonical schema via Tooling API

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** environment setup / testing

Added the remaining 9 fields to `Distributor_Onboarding_Requested__e`
(`scripts/create-platform-event-fields.ts`, via the Tooling API's
`CustomField` sobject, using our existing JWT credentials rather than
clicking through Setup 9 times — a deliberate developer choice, not an
assumption). See `docs/decisions/0003-platform-event-schema.md` for the
full field mapping and why the canonical event stays nested while
Salesforce's fields stay flat.

Updated `subscriber.ts` to map the flat fields back onto the nested
canonical `DistributorOnboardingRequestedEvent` shape (`toCanonicalEvent`),
and `scripts/publish-test-event.ts` to populate all fields. Ran the full
loop again end-to-end — the subscriber now logs the exact nested shape
from `CLAUDE.md`'s example payload, reconstructed from the flat Salesforce
record.

---

### OB-0006: Full Salesforce → ServiceNow chain proven — CLAUDE.md's stated first milestone

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** testing / milestone

Signed up for a ServiceNow Developer Instance (developer did this
directly, same as the Salesforce signup - not something an agent should
do on someone's behalf). Discovered the Machine Identity Console as the
current OAuth setup UI (FL-0007), set up an OAuth Client Credentials grant
after enabling a required-but-not-default system property (FL-0008),
created a dedicated `itil`-role integration user rather than using admin,
and wired it into the integration service
(`src/servicenow/{auth,incidentAdapter}.ts` -
`docs/decisions/0004-servicenow-authentication.md`).

Ran the full chain:

    npm run dev
    npm run publish-test-event -- "Sonoma Valley Distributors"

Result: the subscriber received the Salesforce event, mapped it to the
canonical shape, and created a real ServiceNow Incident (`INC0010001`)
with the distributor/contact/sales details in the description and the
canonical `correlationId` stored in ServiceNow's standard `correlation_id`
field. Confirmed in the ServiceNow UI that the Incident's activity log
shows it was created by the dedicated `Golden Vine Integration` user, not
admin - the least-privilege setup worked as intended.

This is `CLAUDE.md`'s literal "Initial Definition of Success": *"A
developer successfully causes a realistic Salesforce business event to
create or update something in ServiceNow, and we have documented what the
developer experienced while making that happen."* With 10 friction items
and 6 observations logged so far, this is a natural point to consider
Phase 2 (Observation Review) before adding more code - see `CLAUDE.md`'s
"Golden Path Evolution."

---

### OB-0007: Deliberately tested failure modes rather than building retry/idempotency blind

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** error handling / testing

Per `CLAUDE.md`'s Developer #1 principle ("do not prematurely automate a
problem we have not experienced"), rather than building retry/idempotency
handling speculatively, deliberately went and experienced the two
relevant friction questions it lists:

1. **Duplicate delivery:** extended `publish-test-event.ts` to accept a
   fixed correlation ID, published the "same" event twice, and confirmed
   two separate ServiceNow Incidents were created (FL-0011).
2. **ServiceNow unavailable:** ran the subscriber with
   `SERVICENOW_INSTANCE_URL` overridden to an invalid address (inline env
   var, `.env` untouched) and published a real event. The whole process
   crashed on an unhandled rejection rather than failing just that one
   event (FL-0012) - a more severe finding than expected, since combined
   with the `ReplayPreset: LATEST` subscription (no checkpointing), a
   crashed process means silently lost events, not just delayed ones.

Both experiments used only the existing test tooling
(`publish-test-event.ts`, `verify-recent-incidents.ts`) - no new
throwaway scripts needed, which is itself a small validation of LL-0004.

Two concrete, real friction items now exist to inform whatever
retry/idempotency design comes next, rather than guessing at requirements.

---

### OB-0008: Replay checkpoint experiment — offline event successfully recovered

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** error handling / testing / recoverability

Ran the smallest Phase 3 experiment recommended by the second Phase 2
review (`docs/devex/lessons-learned.md` LL-0007): can a Salesforce event
published while the integration service is offline be recovered by
capturing a replay ID and resuming with `ReplayPreset.CUSTOM`? Scope was
deliberately narrow — no retry framework, dead-letter queue, or
idempotency solution was built.

**Investigation first:** called the Pub/Sub API's `GetTopic` RPC directly
(`scripts/get-topic-info.ts`) instead of assuming retention behavior. It
returned only `topicName`, `tenantGuid`, `canPublish`, `canSubscribe`,
`schemaId`, `rpcId` — no retention information at all, contradicting an
earlier (wrong) claim in LL-0007 that the proto exposed a
`retention_policy` field. See FL-0013.

**Minimal code changes made:**
- `src/salesforce/checkpoint.ts` — persists `{ replayId, capturedAt }` as
  JSON to `.checkpoint.json` (gitignored), with `loadCheckpoint()` /
  `saveCheckpoint()`.
- `src/salesforce/pubsubClient.ts` — after each event is successfully
  passed to `onEvent`, its replay ID is saved as the new checkpoint. On
  startup, an existing checkpoint triggers `ReplayPreset.CUSTOM` from
  that position; otherwise `ReplayPreset.LATEST` as before. Both paths
  log clearly (`[checkpoint] ...`) so Developer #1 can see which mode is
  active and why.
- `scripts/get-topic-info.ts` — the investigation script above, kept as a
  reusable tool.

**Checkpoint semantic chosen (not deeply evaluated, just the minimal
option):** "last event successfully passed through `onEvent`" — which in
practice means "ServiceNow Incident successfully created," since
`onEvent` awaits `createOnboardingIncident` and only returns once that
succeeds. This experiment's scenario (ServiceNow always reachable) never
actually exercised the distinction between "received" and "processed" —
that would need combining this checkpoint logic with the FL-0012-style
outage simulation, which wasn't done here. Flagged as still open.

**Controlled experiment (steps A–E):**

    A. Started subscriber fresh (no checkpoint) → "[checkpoint] none
       found - starting with ReplayPreset.LATEST"
    B. Published Event A ("...while online") → received, ServiceNow
       Incident INC0010004 created, checkpoint saved.
    C. Stopped the subscriber (confirmed via `ps aux`).
    D. Published Event B ("...while offline") via
       `publish-test-event.ts` — confirmed via
       `verify-recent-incidents.ts` that no Incident existed yet for its
       correlation ID.
    E. Restarted the subscriber → "[checkpoint] resuming with
       ReplayPreset.CUSTOM from replayId=..." — Event B was received and
       processed, ServiceNow Incident INC0010005 created.

**Result: yes.** A Salesforce event published while the integration
service was offline was successfully recovered on restart, using only a
persisted replay ID and `ReplayPreset.CUSTOM`. This directly answers this
experiment's one question.

**On duplicates (LL-0005 connection) — directly observed, not
suppressed:** Event A was checked after the restart via
`verify-recent-incidents.ts` and had exactly **one** Incident, not two —
`ReplayPreset.CUSTOM` did **not** redeliver the already-checkpointed
event in this run. No duplicate occurred. This does not close LL-0005:
the checkpoint is written *after* `onEvent` succeeds, so a crash between
"Incident created" and "checkpoint persisted" remains an untested gap
where a duplicate would very plausibly still occur. See FL-0014 and the
new LL-0008 for the precise, narrower follow-up question this leaves
open.

---

### OB-0009: Crash-window experiment — confirmed a real duplicate ServiceNow Incident

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** error handling / testing / recoverability

Ran the experiment LL-0008 recommended: does a crash between ServiceNow
successfully creating an Incident and the Salesforce replay checkpoint
being persisted cause that event to be redelivered and reprocessed into
a duplicate Incident on restart? Scope was deliberately narrow — no
idempotency, deduplication, correlation-ID lookup, or retry logic was
added; the only change was a single deterministic test mechanism.

**Mechanism added:** an env-var-gated crash point in
`src/salesforce/pubsubClient.ts` — `EXPERIMENT_CRASH_BEFORE_CHECKPOINT=true`
calls `process.exit(1)` immediately after `onEvent` resolves
successfully and before `saveCheckpoint()` runs. Off by default; changes
no normal-path behavior. Deterministic (not timing/race-based), so the
exact boundary is hit every time it's enabled.

**Controlled experiment (steps A–H), with independent evidence captured
at each boundary rather than trusting any single log source:**

    A. Established a known checkpoint: ran the subscriber normally, let
       it process a baseline event ("Event C"), confirmed both the
       ServiceNow Incident (INC0010006) and the resulting checkpoint
       file contents (replayId ending ...dHR0dDU=, i.e. Event C's).
    B. Stopped the subscriber, restarted it WITH the crash flag set
       (resumed correctly from Event C's checkpoint - unaffected by the
       flag), then published Event D ("...crash target").
    C. Event D was received and processed; ServiceNow confirmed Incident
       creation (INC0010007) - visible in the subscriber's own log.
    D. The deterministic crash fired immediately after, before
       `saveCheckpoint()` ran - confirmed by the absence of a
       "[checkpoint] saved..." log line, and confirmed independently by
       `ps aux` showing no process, and by reading `.checkpoint.json`
       directly: still byte-for-byte Event C's value, not Event D's.
    E. Independently verified via `verify-recent-incidents.ts` (a
       ServiceNow query, not our own log) that exactly one Incident
       (INC0010007) existed for Event D's correlation ID at this point.
    F. Restarted the subscriber normally (crash flag unset this time).
       It resumed with `ReplayPreset.CUSTOM` from the stale, Event-C
       checkpoint, as expected given step D's finding.
    G. Salesforce redelivered Event D - confirmed by the subscriber
       logging "Received DistributorOnboardingRequested event" a second
       time with the identical `eventId`/`correlationId` as before.
    H. The redelivered event was processed normally (no crash flag) and
       created a **second** ServiceNow Incident, INC0010008. Confirmed
       independently: `verify-recent-incidents.ts` showed **two**
       Incidents (INC0010007, INC0010008) for the one correlation ID.

**Result: yes, duplicate processing occurs.** This confirms LL-0008's
inference with direct, reproducible evidence rather than leaving it as a
code-reading guess. The duplicate was not suppressed, worked around, or
fixed - per the experiment's explicit scope, it was only observed and
recorded.

**Distinguishing the four things the experiment was designed to keep
separate:**
- *Salesforce redelivery*: confirmed by the identical `eventId` appearing
  in two separate "Received" log lines, on two separate process runs.
- *Integration-service processing*: confirmed by two separate "Created
  ServiceNow Incident" log lines, each following a full,
  independent trip through `toCanonicalEvent` → `createOnboardingIncident`.
- *ServiceNow side effects*: confirmed independently of our own logs, via
  a live ServiceNow query showing two Incident records.
- *Checkpoint state*: confirmed by reading `.checkpoint.json` directly at
  three points - unchanged after the crash, then advanced only after the
  second (successful, non-crashed) run completed.

**On the "last received" vs. "last successfully processed" semantic
question (deliberately left open in OB-0008):** this experiment didn't
resolve it either, but it does make the trade-off concrete for the first
time: checkpointing *after* ServiceNow succeeds (today's behavior)
produces exactly the duplicate seen here. The natural next question -
what happens if the checkpoint is written *before* calling ServiceNow
instead - was not tested. See `docs/devex/lessons-learned.md` LL-0008
for the recommendation.

---

### OB-0010: Opposite-ordering experiment — confirmed silent event loss, not redelivery

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** error handling / testing / recoverability / observability

Ran the experiment LL-0008 recommended as the direct follow-up to
OB-0009: if the checkpoint is persisted *before* calling ServiceNow, and
the process terminates after that persistence but before ServiceNow is
ever called, does restart skip the event entirely (leaving the business
operation unperformed) rather than reprocess it? Scope stayed as narrow
as OB-0009 - no idempotency, retries, deduplication, or `ManagedSubscribe`
were implemented.

**Mechanism added:** a second env-var-gated experimental block in
`src/salesforce/pubsubClient.ts` -
`EXPERIMENT_CHECKPOINT_BEFORE_SERVICENOW=true` temporarily reverses the
normal order for that one code path: it calls `saveCheckpoint(replayId)`
*before* `onEvent` (the ServiceNow call), then immediately calls
`process.exit(1)` - so `onEvent` never runs and ServiceNow is never
contacted. Off by default; the normal path (checkpoint after `onEvent`)
is untouched when unset, confirmed by rereading the code after the
experiment - no revert was necessary, since the new behavior only exists
inside its own conditional.

**Controlled experiment (steps A–J), evidence kept independent at each
boundary:**

    A. Known checkpoint already established at Event D (from OB-0009's
       final state, replayId ending ...dHR0dDU=, captured
       2026-09-15T20:11:19.992Z) - confirmed by reading
       .checkpoint.json before starting.
    B. Started the subscriber WITH the new flag set (resumed correctly
       from Event D's checkpoint - confirmed the flag doesn't affect
       startup), then published Event E ("...checkpoint-first crash
       target").
    C. Event E was received and decoded (implied - no error logged) -
       see the observability note below on why this can't be confirmed
       as directly as prior experiments.
    D. The checkpoint was persisted BEFORE ServiceNow was ever called -
       logged explicitly: "[experiment]
       EXPERIMENT_CHECKPOINT_BEFORE_SERVICENOW set - checkpoint saved
       BEFORE calling ServiceNow...".
    E. Independently verified the checkpoint actually advanced: read
       `.checkpoint.json` directly - now a new value
       (`...T50AE04t...`, captured 2026-09-15T20:20:23.640Z), distinct
       from Event D's.
    F. Forced termination occurred immediately after (`process.exit(1)`)
       - confirmed independently via `ps aux` showing no process.
    G. Independently verified via `verify-recent-incidents.ts` (a live
       ServiceNow query) that **no** Incident existed for Event E's
       correlation ID at this point.
    H. Restarted the subscriber normally (no experimental flags) -
       resumed with `ReplayPreset.CUSTOM` from Event E's now-persisted
       checkpoint.
    I. Waited ~28 seconds (longer than redelivery took in OB-0009's
       equivalent step) - **no "Received DistributorOnboardingRequested
       event" log ever appeared.** Event E was not redelivered.
    J. Independently re-verified via `verify-recent-incidents.ts`: still
       **zero** Incidents for Event E's correlation ID, after the
       restart. The business operation was never performed.

**Result: yes.** Persisting the checkpoint before calling ServiceNow, and
crashing in that window, causes the event to be silently skipped on
restart - not reprocessed, not recovered, not visible anywhere as a
failure. This directly answers this experiment's one question.

**An observability finding, not planned but significant:** step C
couldn't be confirmed the same way OB-0008/OB-0009 confirmed "receipt" -
in those experiments, `onEvent`'s own console log printed the full
decoded event (including `correlationId`, distributor name, etc.)
because `onEvent` actually ran. Here, the crash happens *before*
`onEvent`, so the only evidence of Event E's existence in the logs is an
opaque base64 replay ID tied to a generic `[experiment]`/`[checkpoint]`
line - nothing human-searchable. The inference that this checkpoint
corresponds specifically to Event E rests on sequencing (it was the only
event published since Event D's checkpoint) and is corroborated
after the fact by steps I/J (no redelivery, no Incident - consistent
with the checkpoint already covering it), not by a direct log
correlation at the time it happened.

**Distinguishing the four things kept separate, as in OB-0009:**
- *Salesforce delivery*: inferred from sequencing and the checkpoint
  change, not directly logged (see observability finding above) - the
  one boundary this experiment could not evidence as cleanly as OB-0009.
- *Integration-service processing*: confirmed **not** to have happened -
  `onEvent`/`createOnboardingIncident` never ran, by design and by the
  absence of any "Created ServiceNow Incident" log on either run.
- *ServiceNow side effects*: confirmed independently, twice (steps G and
  J), via live queries - zero Incidents, both before and after restart.
- *Checkpoint state*: confirmed by reading `.checkpoint.json` directly at
  two points - advanced to a new value immediately after the crash
  (step E), then unchanged through the restart since no further event
  arrived to re-checkpoint.

---

### OB-0011: Investigated silent-loss detectability — confirmed via two independent methods

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** observability / testing / recoverability

Investigated LL-0009's recommended question directly: can a silent loss
be detected after the fact? No idempotency, retries, dedup, or
`ManagedSubscribe` were built - this was read-only investigation.

**Code added:**
- `replayRange()` in `src/salesforce/pubsubClient.ts` - a read-only
  diagnostic that replays events from either a specific base64 replay ID
  (`ReplayPreset.CUSTOM`) or the literal `'EARLIEST'`
  (`ReplayPreset.EARLIEST`, a full sweep), collecting whatever arrives in
  a time window. Touches no runtime state - doesn't import `checkpoint.ts`
  at all, and never calls ServiceNow's write API.
- `scripts/detect-unprocessed-events.ts` - cross-references each replayed
  event's `Correlation_Id__c` against ServiceNow via a read-only query,
  reporting `OK` or `GAP DETECTED` per event.
- A small refactor: extracted `createSchemaResolver()` out of `subscribe()`
  so both it and `replayRange()` share the same Avro schema-caching logic
  without duplication.

**Method 1 - targeted replay from a known anchor:**
Ran `npm run detect-unprocessed-events -- AAAAAAAXT5wAE04tY29yZTEuc2ZkYy04dGd0dDU=`
(Event D's checkpoint, on record from the prior experiment - see OB-0010).
Result: retrieved exactly one event, Event E, with its real
`correlationId` intact, and correctly flagged it `GAP DETECTED` after
querying ServiceNow and finding nothing. The returned `replayId` matched
byte-for-byte the value independently known to be Event E's (from
OB-0010's own checkpoint-file evidence).

**A limitation surfaced immediately:** this method requires already
knowing a replay position from *before* the suspected loss.
`.checkpoint.json` only ever holds the single latest value (confirmed by
reading `checkpoint.ts`: `writeFileSync` fully overwrites, no append/log)
- and that latest value, right now, *is* Event E's own (post-loss)
position. The only reason Event D's position was available at all is
that it happened to be recorded in this project's own conversation
history, not because the running system retains it. See FL-0017.

**Method 2 - full sweep from EARLIEST, no prior knowledge required:**
Tested whether `ReplayPreset.EARLIEST` is viable at all (a throwaway
script, deleted after use) before committing to it - it returned **all
11 events** ever published to this topic across this project's entire
testing history, not just a recent window. Ran
`npm run detect-unprocessed-events` (defaults to `EARLIEST`) and got a
complete, correctly-classified account of every event:

    SKIPPED      - "Acme Distribution Co" (no Correlation_Id__c - predates
                    the full canonical schema, OB-0004's original milestone
                    test, handled gracefully rather than crashing)
    GAP DETECTED - "Golden Gate Distributors" (predates the ServiceNow
                    adapter existing at all - OB-0005's schema-expansion
                    test, before incidentAdapter.ts was ever wired in -
                    independently re-confirmed via verify-recent-incidents.ts;
                    a real gap, but NOT the LL-0009 bug)
    OK           - "Sonoma Valley Distributors" (INC0010001, OB-0006's
                    first full-chain milestone)
    OK   (x2)    - "Duplicate Test Co" (FL-0011's deliberate double-publish
                    - both Incidents exist, so both show OK; this method
                    detects absence, not over-counting - see below)
    GAP DETECTED - "Outage Test Co" (FL-0012's simulated ServiceNow outage
                    - the process crashed before ever calling ServiceNow)
    OK           - Events A, B (OB-0008's recovery experiment)
    OK           - Event C (OB-0009's baseline)
    OK           - Event D (OB-0009's crash target - FL-0015's confirmed
                    duplicate; again shown OK since at least one Incident
                    exists)
    GAP DETECTED - Event E (OB-0010's silent-loss target - the specific
                    case this investigation set out to confirm)

Every classification was consistent with what this project's history
already independently established; two were spot-checked again via a
fresh `verify-recent-incidents.ts` call and matched.

**Result: yes, confirmed by two independent methods.** A silent loss can
be detected after the fact. The full-sweep method is the more practically
useful of the two, since it needs no stored anchor at all - but it's also
not automatic: nothing in this codebase currently triggers it, so
detection today means a human deciding to run it.

**A stated limitation, not a gap in this investigation:** this method
finds correlation IDs with **zero** matching Incidents (silent loss). It
does **not** find correlation IDs with **more than one** (LL-0005's
duplicate problem) - both "Duplicate Test Co" and Event D show `OK`
despite each genuinely having two Incidents, because the query only
checks existence. A single unified reconciliation tool covering both
known failure modes would need to count, not just check presence.

---

### OB-0012: Detector extended to count Incidents — validated against complete known history with zero discrepancies

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** observability / testing

Closed OB-0011's stated limitation: `scripts/detect-unprocessed-events.ts`
now counts matching ServiceNow Incidents per correlation ID instead of
only checking existence, classifying each replayable event as `GAP` (0),
`OK` (1), or `DUPLICATE` (>1), with a separate `UNEVALUABLE` category for
events predating `Correlation_Id__c`'s existence - explicitly not
counted as `GAP`, since absence of a side effect can't be established for
something that predates the field used to look it up. Duplicate evidence
(Incident numbers, count) is reported, never altered. Scope stayed
strictly to the audit script: `replayRange()`, `checkpoint.ts`,
`subscriber.ts`, `incidentAdapter.ts`, and all runtime processing/replay/
checkpoint/retry/idempotency behavior are unchanged - confirmed via
`git status` showing only the script file modified.

**Ran across the complete available history** (`npm run
detect-unprocessed-events`, `EARLIEST` sweep, all 11 events) and compared
against this project's own known experimental record, point by point:

| Event | Predicted | Actual | Match |
|---|---|---|---|
| "Acme Distribution Co" (no `Correlation_Id__c`) | UNEVALUABLE | UNEVALUABLE | ✓ |
| "Golden Gate Distributors" (predates ServiceNow adapter) | GAP | GAP | ✓ |
| "Sonoma Valley Distributors" (INC0010001) | OK | OK, `incidents=[INC0010001] count=1` | ✓ |
| "Duplicate Test Co" event #1 (FL-0011) | DUPLICATE | DUPLICATE, `incidents=[INC0010002, INC0010003] count=2` | ✓ |
| "Duplicate Test Co" event #2 (FL-0011) | DUPLICATE | DUPLICATE, same evidence as #1 | ✓ |
| "Outage Test Co" (FL-0012) | GAP | GAP | ✓ |
| Event A (OB-0008) | OK | OK, `incidents=[INC0010004] count=1` | ✓ |
| Event B (OB-0008) | OK | OK, `incidents=[INC0010005] count=1` | ✓ |
| Event C (OB-0009 baseline) | OK | OK, `incidents=[INC0010006] count=1` | ✓ |
| Event D (FL-0015) | DUPLICATE | DUPLICATE, `incidents=[INC0010008, INC0010007] count=2` | ✓ |
| Event E (FL-0016) | GAP | GAP | ✓ |

Summary line: `UNEVALUABLE=1 GAP=3 OK=4 DUPLICATE=3` - matches the
predicted tally exactly. **Zero discrepancies found.** Per instructions,
no classification logic was adjusted to chase this result - the
prediction was made from this project's own prior, independently-recorded
history before running the tool, and the tool's output was taken as-is.

Specifically confirms all four things this validation set out to check:
- Known missing-side-effect events ("Golden Gate Distributors", "Outage
  Test Co", Event E) all classified `GAP`.
- Normal successfully-processed events (Sonoma Valley, A, B, C) all
  classified `OK`.
- Both intentionally-produced duplicate cases ("Duplicate Test Co" x2,
  Event D) all classified `DUPLICATE`, with Incident numbers and count as
  independently-checkable evidence.
- The one event lacking `Correlation_Id__c` classified `UNEVALUABLE`, not
  `GAP`.

**A developer-experience note, not a bug:** because "Duplicate Test Co"
was published twice with the *same* `correlationId`, both Salesforce
events appear as separate report lines with **identical** evidence (same
two Incident numbers, same count) - each line is independently correct
(that correlation ID really does have two Incidents), but a reader
scanning output quickly could mistake the repeated evidence for a
reporting bug rather than two Salesforce-side events sharing one
correlation ID. Worth knowing when reading this tool's output, not worth
fixing - collapsing by correlation ID would lose the "how many Salesforce
events map to this ID" signal, which is a different, also-useful question
than "how many Incidents."

This remains an experimental/audit instrument, not promoted into any
runtime path or the Golden Path - it is not run automatically, and
nothing currently triggers it.

---

### OB-0013: Reliability architecture spike — investigated candidates, chose none

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** architecture / research

With enough deliberately-produced experimental evidence in hand
(FL-0011–FL-0017, OB-0007–OB-0012, LL-0005–LL-0011), stepped back from
individual experiments to investigate architecture candidates for the
business invariant "exactly one Incident per business event" - without
implementing any of them. Full document:
`docs/architecture/0001-reliability-architecture-spike.md`.

Examined four candidates (target-side ServiceNow idempotency,
lookup-before-create, integration-owned durable processing state, and
Salesforce's `ManagedSubscribe`/`CommitReplay`), plus one more surfaced
during investigation (the Pub/Sub API's `ProducerEvent.id` field), each
against the six failure modes this project has actually reproduced or
directly reasoned about from evidence.

**Concrete new findings, not assumed:**
- Read `pubsub_api.proto`'s `ManagedFetchRequest`/`CommitReplayRequest`
  definitions directly: `ManagedSubscribe` is explicit open beta, needs a
  separate `ManagedEventSubscription` Tooling API record, and
  `CommitReplayRequest` carries *only* a replay ID - nothing about any
  downstream side effect. Conclusion: it solves the replay/checkpoint
  durability problem (FL-0017) and nothing about the side-effect
  atomicity problem this project has been investigating since LL-0008.
- Attempted to query ServiceNow's `sys_dictionary` for the
  `correlation_id` field's constraints, using the existing dedicated
  `itil`-role integration user - blocked: "Insufficient rights to query
  records." A genuine platform-access finding: schema investigation
  itself needs privileges beyond what ADR 0004 deliberately granted.
- No prior documentation was found to be wrong this round (unlike the
  last investigation's FL-0013 correction) - stated explicitly rather
  than left silent.

**Result:** two candidates (target-side idempotency, integration-owned
durable state) fully cover every demonstrated failure mode on paper;
lookup-before-create is a cheap but race-prone mitigation;
`ManagedSubscribe` is orthogonal. No architecture was chosen - the
evidence doesn't yet discriminate between the two strongest candidates,
and the spike document says so rather than picking one anyway. No ADR was
written for the same reason.

---

### OB-0014: Concurrency experiment — two simultaneous requests for the same business operation both succeeded, producing two Incidents

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability

The spike (OB-0013) recommended checking whether ServiceNow can actually
enforce a uniqueness invariant, not just support a lookup-before-create
pattern. Ran the smallest controlled version of that test:
`scripts/test-servicenow-concurrent-idempotency.ts` generates one
business-operation ID, then fires **two Incident-create `POST` requests
concurrently via `Promise.all`** (not sequentially, and not
lookup-then-create) against `/api/now/table/incident`, using the
existing `itil`-role OAuth credentials from `.env` — no privilege change.

**Result:** both requests received `201 Created`. Both succeeded.
ServiceNow created **two separate Incidents** (`INC0010009`,
`INC0010010`) carrying the identical `u_gv_business_operation_id`.
Neither caller was rejected, rate-limited, or told about the other's
request — each received a full, ordinary success response as if it were
the only request in flight. A follow-up independent query
(`GET` filtered on that business-operation ID) confirmed both records
exist.

This is the direct, concrete counterexample to "ServiceNow enforces
this" for the current configuration: no unique index is actually in
place on `u_gv_business_operation_id` (FL-0018 — attempts to create one
did not result in a persisted constraint), so this result answers the
narrower question "what happens today, with no enforced constraint" (the
null hypothesis) rather than the broader question "can ServiceNow ever
enforce this" (still open per FL-0018). Both questions matter and are
kept distinct in `docs/architecture/0001-reliability-architecture-spike.md`.

---

### OB-0015: The `itil` integration account's privilege gap and ServiceNow admin access are two different platform-ownership concerns

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** platform / enterprise-integration

OB-0013 already noted the `itil`-role integration user (ADR 0004) can't
query `sys_dictionary` ("Insufficient rights to query records"). This
round required an actual answer to the schema question, so a separate,
human-authenticated ServiceNow admin browser session was used instead —
deliberately, per this round's explicit instruction not to expand the
`itil` account's runtime privileges just to conduct research.

Worth naming as its own observation, not just a blocker to work around:
this is a second, legitimate instance of a pattern real enterprise
integration teams hit constantly. **Runtime least privilege (what the
integration's service account can do in production) and
platform-development/admin privileges (what's needed to design or
inspect schema, indexes, or configuration) are different concerns with
different intended owners** — a dedicated `itil` user is the right
runtime choice (ADR 0004 was not wrong), but nothing about that choice
was ever meant to also serve platform-administration needs, and treating
the two as one role is itself a common real-world misconfiguration this
project's ADR 0004 avoided by accident more than by naming the
distinction outright. This may eventually matter for what the Golden
Path needs to document about platform ownership and environment setup —
noted here rather than acted on, since no Golden Path work is in scope
yet.

---

### OB-0016: Elevating security_admin and removing duplicate data resolved two real causes — but the unique index still does not persist

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability / platform

Direct continuation of FL-0018, specifically to answer one question:
*can ServiceNow provide an enforceable target-side uniqueness invariant
that prevents two concurrent creates for the same business-operation
ID?* Full account in FL-0018's "Follow-up 2026-09-15" section; this
entry records the outcome for the observation log.

**Two real, confirmed causes were found and fixed, in order:**

1. `security_admin` was assigned to the admin account but not elevated
   for the session — confirmed via the platform's own UI (the avatar
   menu's `aria-label` changed from `"System Administrator: Available"`
   to `"System Administrator: security_admin, Available"` after using
   the built-in "Elevate role" action). Elevating changed real
   server-side behavior: the same wizard submission went from a silent
   `200` with no feedback to a specific, correct validation error.
2. That error was correct: OB-0014's own concurrency experiment had left
   a genuine duplicate value in `u_gv_business_operation_id`
   (`INC0010009` and `INC0010010` both carried the same value). Cleared
   it on one record (field only, record not deleted) and verified
   independently that the duplicate was gone.

**With both fixed, the index-creation flow still does not result in a
verifiable, persisted unique constraint.** Checked four independent
sources after a real submission with no error path taken: `sys_index`
(filtered query, still zero rows), `staged_alter_history` (ServiceNow's
own schema-alteration tracking table — empty for every table in this
instance, not just this one), `sys_email` (no completion notification,
despite the UI's own message text describing one), and `sys_dictionary`
(still no native uniqueness field on the target column). All four agree.

**This is a stronger, more specific negative result than FL-0018's
original entry, not a repeat of it.** The two most plausible blockers
(privilege, dirty data) were directly tested and eliminated as the
explanation, which narrows what's actually going on without resolving
it. Per this round's explicit instruction, the concurrency experiment
was **not** rerun under an "enforced" premise, since no enforcement
could be independently verified as active — rerunning it would have
either reproduced OB-0014's exact result (uninformative) or, worse,
risked being misread as testing a real constraint that doesn't exist. No
workaround (application-level locking, lookup-before-create, or any
other idempotency mechanism) was implemented as a substitute, per
instruction.

---

### OB-0017: Durable-state prototype — atomic create-if-absent held cleanly across 5/5 concurrent trials

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability

With ServiceNow's target-side uniqueness left unverified (FL-0018,
OB-0016), built the smallest possible investigation-only prototype of
Candidate C (integration-owned durable processing state) to test it the
same adversarial way: two genuinely concurrent attempts for one
business-operation ID, not lookup-then-create.

`scripts/lib/idempotencyStore.ts` uses `node:sqlite` (built into Node
22, zero new dependency) with a `PRIMARY KEY` constraint on
`business_operation_id` as the atomic gate - every caller attempts an
`INSERT` directly; the database engine's constraint, not a prior
`SELECT`, decides the single winner. Only the winner ever calls
ServiceNow. `scripts/test-durable-state-concurrent-idempotency.ts` runs
this five times with a fresh ID each time via `Promise.all`.

**Result: 5/5 iterations clean.** Exactly one caller acquired ownership
each time; the loser's `acquire()` returned `false` and it never made an
HTTP call at all (confirmed in the per-attempt result, not inferred);
ServiceNow independently confirmed exactly one Incident per business
operation each time; the durable-state record matched. This is a
genuinely different shape of result from ServiceNow itself (OB-0014):
there, the losing request reached ServiceNow and was incorrectly
accepted; here, the losing request never reaches the external system in
the first place - the invariant is enforced one layer earlier.

**Honesty check on what "concurrent" means here:** unlike the real
HTTP-based race against ServiceNow (where either request could win
unpredictably due to actual network timing), `acquire()` is synchronous
and JS is single-threaded - `Promise.all([attempt('A'), attempt('B')])`
means A's synchronous `acquire()` call always runs to completion before
B's begins, so A deterministically won all 5 iterations. That is not a
flaw in the experiment; it is the correct, honest characterization of
what was tested: whether the atomic primitive structurally guarantees
the invariant regardless of caller ordering (yes, by construction),
**not** whether it survives a genuine race the way the ServiceNow test
did. Both are legitimate but different senses of "concurrent," and this
entry avoids conflating them.

---

### OB-0018: Durable-state prototype — the same gate produces permanent silent loss if the process crashes before calling ServiceNow

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability

Direct follow-up to OB-0017, prompted by the explicit question: does
preventing duplicates this way introduce a new failure mode symmetric to
FL-0016/OB-0010 (checkpoint-before-ServiceNow causing silent loss)?
`scripts/test-durable-state-crash-gap.ts` deliberately acquires
ownership of a business-operation ID, then does **not** call ServiceNow
and does **not** mark it completed - simulating a crash in exactly that
gap - closes and reopens the SQLite store (a real process-restart
simulation, not a JS-variable check: the `INSERT` was already durably
committed to disk before the "crash"), then simulates a redelivery
attempt for the same ID.

**Result: exactly the predicted failure mode, confirmed rather than
assumed.** The record survived the simulated crash, still `in_flight`.
The redelivery attempt's `acquire()` call was blocked (`false`) - the
store cannot distinguish "someone else is genuinely mid-flight right
now" from "a prior attempt crashed and never finished"; both look
identical, a row already exists. An independent ServiceNow query
confirmed zero Incidents exist for this business-operation ID. This
business operation can never produce a ServiceNow Incident again through
this path - permanently and silently, with no error and no log trail
distinguishing it from a legitimate in-progress request.

**This directly answers the explicit concern behind the experiment:**
atomically preventing duplicates is necessary but not sufficient: a
mechanism that trades OB-0014's failure mode (duplicate) for this one
(permanent silent loss) is not an improvement, it is a different
failure mode with worse detectability (OB-0014's duplicates were at
least visible as two Incidents; this failure mode produces zero
Incidents and zero errors). A real implementation would need a way to
distinguish stuck from active records - e.g. a staleness timeout plus an
explicit reclaim path - deliberately not designed or built here, per
this round's instructions.

---

### OB-0019: ServiceNow `sys_index` creation blocked by a genuine platform ACL for manual inserts; the supported wizard's separate failure confirmed on a third, maximally clean scenario

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability / platform

Bounded, final investigation of Candidate A per explicit instruction:
determine whether this ServiceNow environment can enforce target-side
uniqueness, without building any workaround to force success. Full
account: FL-0018's second follow-up.

**Root cause of the raw `sys_index.do` form's "Invalid insert" is now
established with certainty, not inferred:** its `create` Access Control
requires role `nobody` (a role no user can hold) with
`admin_overrides=false` (so even `admin` gets no automatic bypass) -
read directly from `sys_security_acl.do`, authored by `system` in 2015.
This is a deliberate, universal ServiceNow platform restriction on
directly inserting index metadata records, not a fixable permissions
gap.

**The supported "Database Indexes" wizard - built, presumably, to work
around that exact restriction - was retested three ways, with
`security_admin` freshly re-elevated and independently confirmed active
for this session** (elevation does not persist across browser sessions;
redone and reverified via the account's own avatar label): a plain
non-unique index on the existing field (isolating whether uniqueness
itself was the problem - it wasn't), a unique index on the same field
with data confirmed clean, and a unique index on a brand-new, empty,
single-column custom table created specifically for this test
(isolating whether `incident`'s size or `task` inheritance was the
cause). All three: `200` responses, no error, no native dialog
triggered, and zero persisted `sys_index` record in each case.

**This round's contribution is narrowing, not just repeating:**
privilege, dirty data, table complexity, and field type are now each
individually ruled out as the wizard's blocker, through direct
elimination rather than assumption. What ACL-reading also clarified:
the wizard's failure is a genuinely different, still-unexplained
problem from the raw form's - the raw form is blocked by a documented,
readable ACL; the wizard (which does not hit that same ACL - its
requests return success-shaped responses, not "Invalid insert") fails
for a reason this browser-based investigation cannot observe, most
plausibly an edition/plugin-level restriction on this specific
developer instance's schema-alteration capability.

**No workaround was built to force a result**, per explicit instruction
- no custom business rule, no application-level lock, no lookup-before-
create substituted and presented as equivalent. Import Set + Transform
Map coalesce (the other named alternative mechanism) was deliberately
not hands-on tested this round to keep the investigation bounded;
reasoned about instead (FL-0018) and flagged as unverified reasoning,
not a tested result. Because no enforceable constraint could be
configured, the business-operation concurrency experiment was not
rerun a third time.

---

### OB-0020: Staleness-based reclaim is safe for one crash boundary and unsafe for the other — and the durable record cannot tell them apart on its own

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability

Direct follow-up to OB-0018's confirmed permanent-loss failure mode.
Question: can a stale `in_flight` record be safely reclaimed after a
crash, without reintroducing OB-0014's duplicate? Extended
`scripts/lib/idempotencyStore.ts` with exactly one new function,
`reclaim()` - an atomic, conditional `UPDATE ... WHERE status='in_flight'
AND acquired_at < cutoff`, the same "constraint decides, not a prior
read" principle as `acquire()`. No lease token, no heartbeat, no retry
framework.

`scripts/test-durable-state-reclaim-ambiguity.ts` produced two crashed
operations that reach **identical durable-record shape**
(`status=in_flight`, no incident recorded, no completion timestamp) by
two different real paths: Case 1 crashes before ever calling ServiceNow;
Case 2 calls ServiceNow for real (a genuine Incident is created), then
crashes before recording completion. Printed both records side by side
and confirmed they differ only in `businessOperationId`/`acquiredAt` -
nothing in the record itself reveals which case actually happened.

After a real 2.5-second wait (elapsed time, not simulated), both records
reclaimed successfully (`reclaim()` returned `true` for both). Reclaim
followed by a retried ServiceNow create, independently verified via a
fresh Table API query for each business-operation ID:

- **Case 1: exactly 1 Incident.** Reclaiming a genuinely abandoned
  operation and completing it worked correctly, exactly once.
- **Case 2: exactly 2 Incidents** - the original, real one from before
  the simulated crash, plus a second one from the naive retry.
  **Naive staleness-based reclaim reintroduced OB-0014's duplicate
  failure exactly as hypothesized**, not merely as a theoretical risk.

**Answer to the question this experiment set out to answer: elapsed
time can determine that an operation has been abandoned, but it cannot
determine whether the abandoned attempt already succeeded.** Those are
two different questions, and the durable record as currently modeled
only ever answers the first one. This was demonstrated, not assumed -
both crash paths were actually run, both durable records were actually
compared, and both outcomes were independently confirmed against real
ServiceNow data, not trusted from local state.

No workaround beyond the bare elapsed-time check was implemented, per
instruction - the duplicate in Case 2 was observed and reported, not
suppressed or explained away.

---

### OB-0021: Target reconciliation resolves both crash cases and concurrent reclaim ownership — the slow-worker race remains untested by construction

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability

Direct follow-up to OB-0020, testing the fix its own finding pointed to
(LL-0015): after atomically reclaiming a stale operation, can querying
ServiceNow directly by business-operation ID distinguish "already
happened" from "never happened" well enough to recover both crash cases
without either a gap or a duplicate?

`scripts/test-durable-state-reclaim-reconciliation.ts` repeats OB-0020's
exact two cases (Case 1: crash before ServiceNow; Case 2: ServiceNow
succeeds for real, then crash before local completion) with one change
after reclaim: instead of naively retrying, query ServiceNow by
business-operation ID first. Found -> record the discovered Incident as
completion, don't create. Absent -> create, then record completion.
Reconciliation is used only on this reclaim path - the existing
`acquire()` remains the sole concurrency gate for normal, first-time
processing; this does not reopen Candidate B's already-rejected
lookup-before-create question for new work.

**Case 1 (crash before ServiceNow): 1 Incident, independently verified.**
Reconciliation correctly found nothing, then created and recorded
exactly once.

**Case 2 (crash after ServiceNow succeeds): 1 Incident, independently
verified, and confirmed to be the *original* Incident's `sys_id`** -
not a new one. Reconciliation found the real Incident from before the
simulated crash and recorded it as the completion; no second create was
attempted. This is the result OB-0020's naive reclaim could not
produce.

**Extended the same experiment with a third case, per instruction, to
check whether the fix itself is exploitable:** two concurrent `reclaim()`
attempts fired at the same stale record. Exactly one succeeded
(`changes > 0` for one caller, `0` for the other - the same "constraint
decides" atomic guarantee as `acquire()`, OB-0017), and only the winner
reconciled/completed. Independently verified: exactly 1 Incident, not 2.
Concurrent reclaim ownership is exclusive, not merely usually exclusive.

**Explicitly left unresolved, per instruction, not overlooked:** the
slow-but-not-dead worker race identified alongside OB-0020 - Worker A's
ServiceNow call still genuinely executing when Worker B considers A
stale, reclaims, reconciles (finds nothing, because A hasn't written a
result anywhere reconciliation can see yet), and calls ServiceNow
itself, followed by A's original call finally completing. **This
experiment does not establish anything about that race and does not
claim to** - by construction, every phase of this script fully
completes and closes its store handle before the next phase begins,
so there is no point where an "original worker" is genuinely still
executing while a second worker reclaims. Producing that race would
require two truly concurrent, long-running processes, which this
prototype has never modeled.

---

### OB-0022: The slow-owner race is real, deterministic, and confirmed with genuinely independent processes — 3/3 iterations produced a duplicate

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / reliability

Direct reproduction of the race OB-0020/OB-0021 named but explicitly
could not test, because every experiment so far ran sequentially in one
process. This one doesn't: `scripts/lib/slowWorkerA.ts` and
`scripts/lib/slowWorkerB.ts` are separate scripts, spawned as genuinely
independent OS processes (`child_process.spawn`, each with its own
Node runtime) by `scripts/test-durable-state-slow-worker-race.ts`, both
operating against the same on-disk SQLite store and the same real
ServiceNow instance at the same time.

**Worker A** ("original owner"): acquires a fresh business-operation
ID, waits 6000ms (simulating real, still-in-progress work - not a
crash), then calls ServiceNow for real and records completion. **Worker
B** ("recovery owner"): starts ~300ms after Worker A, waits 2500ms
(past the 2000ms staleness threshold), reclaims the now-stale record,
reconciles against ServiceNow (the existing "C-reconciliation"
mechanism from OB-0021, unmodified), finds nothing (because Worker A
hasn't called ServiceNow yet), and creates its own Incident.

**Result, independently verified against ServiceNow, 3/3 iterations:**
two real Incidents exist for the same business-operation ID every time
(e.g. `INC0010022`/`INC0010023`, `INC0010024`/`INC0010025`,
`INC0010026`/`INC0010027`). No workaround was added to prevent or hide
this - both Incidents were left in place and the result recorded as-is,
per instruction. The wide, fixed timing margin (Worker A's delay is 3x
Worker B's full reclaim-through-completion cycle) means this is a
deterministic confirmation, not a lucky scheduling result - the same
outcome occurred on every run with no variance.

**A second, sharper finding beyond "a duplicate exists":** the *local*
durable record after both workers finish shows only **one** Incident -
whichever worker's `markCompleted()` call happened to run last (Worker
A, since it's the slower of the two). Neither worker's completion write
checks whether it still owns the record before writing - there is no
fencing token, so Worker A has no way to know it was reclaimed. The
local record is therefore not merely incomplete (as in OB-0018's honest
"still `in_flight`" signal) but **actively misleading**: it reports
"completed" with exactly one Incident number, while ServiceNow actually
holds two. A system trusting only the local record would never notice
the duplicate at all.

Neither worker behaved incorrectly given the information available to
it - Worker B correctly followed the existing reclaim + reconciliation
logic exactly as designed, and found what was true to find at that
moment; Worker A correctly completed the work it was originally given.
The mechanism has no way to give either of them the missing piece: that
the other was also acting on the same business-operation ID.

---

### OB-0023: ServiceNow's Table API has no conditional-write mechanism at all - confirmed by official documentation and direct testing, not assumed

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience
**Category:** experiment / research / platform

Direct follow-up to OB-0022, narrower than FL-0018's schema-level
investigation: does ServiceNow's Table API, or another directly usable
ServiceNow record-creation API, let the *target* atomically reject a
create when a business condition no longer holds or a record already
exists - not a client-side lookup, not a client-side fencing check
(both already rejected, OB-0014 and OB-0022 respectively)?

**Official documentation checked first, not assumed.** Fetched
ServiceNow's own Table API reference
(`servicenow.com/docs/.../c_TableAPI.html`, Washington DC release)
directly. It documents the exact header set each operation (`GET`,
`POST`, `PUT`, `PATCH`, `DELETE`) accepts. **None of the five operations
document `ETag`, `If-Match`, `If-None-Match`, or any conditional/
precondition mechanism at all** - not just missing from `POST`, missing
from the entire API surface.

**Verified empirically against the real instance, not trusted from
documentation alone**, via `scripts/test-servicenow-conditional-create.ts`
(itil-role credentials, no privilege change):

- Neither a list `GET` nor a single-record `GET` returns an `ETag` or
  `Last-Modified` header - there is no version identifier for a
  conditional request to even reference.
- A `POST` (create) sent with `If-None-Match: *` succeeded normally
  (`201`) - the header was silently ignored, not enforced and not
  rejected as unsupported.
- **Two concurrent `POST`s for the same business-operation ID, both
  carrying `If-None-Match: *`, both succeeded** - independently
  verified, 2 Incidents resulted. The textbook HTTP conditional-create
  pattern provides zero protection here, confirmed directly rather than
  inferred from the missing documentation.
- `PUT` to a deliberately never-used `sys_id` returned `404 No Record
  found` - `PUT` is update-only in this API; there is no
  upsert-via-`PUT` path to even attach a conditional header to.

**Import Set + Transform Map coalesce** (flagged as reasoned-but-untested
in FL-0018's second follow-up) was checked against public ServiceNow
community reports rather than built and tested hands-on this round, to
keep the investigation bounded per instruction: multiple independent
reports describe coalesce producing duplicate records under
concurrent/repeated submission via the REST API, consistent with the
existing reasoning that coalesce performs an existence check and a
write as two separate steps, not one atomic operation.

**GraphQL mutations** were checked and found not to be a ready-made
mechanism either - ServiceNow's GraphQL framework requires a
*Scripted resolver* (custom `GlideRecord`-based server-side code
written by the developer) to implement a `createIncident`-style
mutation at all. No built-in conditional-create or optimistic-concurrency
primitive exists for it to inherit; building one would mean writing new
ServiceNow server-side code - implementation, not investigation, and
explicitly out of scope this round.

**Conclusion: confirmed no.** No standard, non-custom-scripted
ServiceNow API in this environment lets the target atomically evaluate
a business condition or fencing/generation value as part of accepting a
create. This is not merely "not yet found" - it is documented as absent
across the entire Table API surface and directly confirmed absent by
testing the one candidate mechanism (`If-None-Match`) that would have
been usable without writing any new ServiceNow-side code.

---

### OB-0024: The reliability investigation reaches a decision — ADR 0005 adopts a two-tier contract, nothing implemented yet

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience
**Category:** architecture / decision

With OB-0014 through OB-0023 establishing what does and doesn't hold up
under failure for both candidates, the investigation reached the point
this project's own operating instructions call for: "make an
architectural decision if the existing evidence is sufficient."
`docs/decisions/0005-external-side-effect-reliability-contract.md`
reconstructs the evidence chain (source delivery/replay → checkpoint
ordering → duplicate vs. loss windows → atomic durable ownership →
crash recovery → reclaim → target reconciliation → slow-owner race →
target enforcement investigation) and decides a **two-tier reliability
contract**:

- **Tier 1 (mandatory, any target):** recoverable at-least-once
  processing via durable ownership + reclaim + target reconciliation,
  mandatorily paired with audit-based detection of residual `GAP`/
  `DUPLICATE` (extending the validated `detect-unprocessed-events.ts`
  pattern, OB-0012) - explicitly **not** exactly-once external effects.
- **Tier 2 (opt-in, earned per target):** exactly-once external
  effects, only once a target is *proven*, by the same experimental
  rigor as this entire investigation, to enforce uniqueness itself.
  ServiceNow, as configured here, has not earned it (FL-0018, OB-0019,
  OB-0023).

The ADR distinguishes terms this investigation found routinely
conflated - message delivery semantics, processing ownership,
business-operation identity, external side-effect idempotency,
reconciliation, exactly-once processing, and exactly-once external
effect - and evaluates four options (target enforcement alone;
integration-owned reliability alone; integration-owned reliability plus
detection; the tiered hybrid) against evidence, not convention, before
selecting the tiered option because it is the only one that doesn't
either overclaim what's proven or discard what already works.

**Nothing has been implemented as part of this decision.** The ADR's
own recommended first Enablement step - wiring the already-validated
Tier 1 mechanisms into the real service, and scheduling the audit tool
instead of running it on demand - remains future work, not undertaken
here.

---

### OB-0025: Tier 1 wired into the real service — normal processing and concurrent-initial-processing protection both confirmed against the actual production code path

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)
**Category:** implementation / verification

First Enablement-phase implementation of ADR 0005's Tier 1 baseline:
`src/reliability/idempotencyStore.ts` (a production-shaped extraction
of the mechanism validated experimentally in
`scripts/lib/idempotencyStore.ts` - `acquire`/`complete` only, no
`reclaim`, per this round's explicit scope) and
`src/processDistributorOnboardingEvent.ts` (the atomic-acquire →
ServiceNow-create → record-completion path from the ADR's diagram),
now called by `src/index.ts` for every real event. This is not another
architectural finding - it is a check of whether what OB-0014 through
OB-0023 proved experimentally still holds once moved into the real,
running service, driven by the actual Salesforce → ServiceNow path
rather than a synthetic harness.

**Normal processing, verified end-to-end against real systems:**
started the real subscriber (`npm run dev`), published one fresh test
event, and confirmed: the event was received and processed through the
new gate; exactly one Incident was created in ServiceNow, independently
verified via `verify-recent-incidents.ts` (not trusted from the
subscriber's own log); the local `.idempotency.sqlite` record
independently showed `status: completed` with the matching `sys_id`/
`number`; and the replay checkpoint was saved immediately afterward, as
before.

**Concurrent initial-processing protection, verified through the real
processing function, not just the extracted store:**
`scripts/test-production-concurrent-idempotency.ts` calls the exact
function `src/index.ts` calls - `processDistributorOnboardingEvent()` -
twice concurrently via `Promise.all`, for two synthetic deliveries
(distinct Salesforce event IDs) of the same business-operation ID.
Result: exactly one delivery created an Incident, the other was
correctly rejected as already-owned; independently verified against
ServiceNow (by `correlation_id`, the field `incidentAdapter.ts` has
always used and which this round left unchanged) - exactly one
Incident exists. The production extraction preserves OB-0017's proven
property.

**Replay/checkpoint behavior confirmed unregressed:** stopped and
restarted the real subscriber after processing the fresh event above;
it resumed with `ReplayPreset.CUSTOM` from the newly-saved checkpoint
(not `LATEST`, not the stale pre-existing one), and did not reprocess
the already-checkpointed event - matching the behavior established in
OB-0008/FL-0014, unaffected by this round's change (`pubsubClient.ts`
and `checkpoint.ts` were not modified).

**What this round deliberately did not test or build, per ADR 0005's
explicit scope:** stale-operation recovery (reclaim), scheduled/
automatic auditing, and genuine multi-process concurrency at the real
entry point (see FL-0022 for why the latter specifically was not
attempted this round, and what would need to change first).

---

### OB-0026: Stale-operation recovery wired into the real service — both crash boundaries and concurrent reclaim confirmed against production abstractions and live ServiceNow

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)
**Category:** implementation / verification

Second Enablement-phase implementation round, extending OB-0025:
`src/reliability/idempotencyStore.ts` gained `reclaimOperation()` (the
production form of `scripts/lib/idempotencyStore.ts`'s `reclaim()`,
OB-0020/OB-0021 - same "constraint decides, not a read" `UPDATE ...
WHERE` shape, `staleAfterMs` still caller-supplied, no default baked
in). Target reconciliation was deliberately kept out of that module:
`src/servicenow/incidentReconciliation.ts` (queries ServiceNow's
standard `correlation_id` field - the one `incidentAdapter.ts` already
writes, not the experimental `u_gv_business_operation_id` field the
prototype used) and `src/recoverStaleDistributorOnboardingOperation.ts`
(the reclaim → query → complete-or-create orchestration from ADR 0005's
recovery diagram) are new, separate modules. This is again a check of
whether OB-0020/OB-0021's experimentally-proven recovery behavior still
holds once moved into the real service and driven against live
ServiceNow, not a new architectural finding.

**All three properties confirmed via `scripts/test-production-recovery.ts`
(`npm run test-production-recovery`), driven through the real production
functions, independently verified against ServiceNow after each case:**

- **Case 1 (crash before the ServiceNow call):** `acquireOperation()`
  called directly with no following `createOnboardingIncident()` call,
  simulating exactly OB-0018's crash boundary. After the operation
  became genuinely stale, `recoverStaleDistributorOnboardingOperation()`
  reclaimed it, found nothing via reconciliation, and created Incident
  INC0010033. Independently verified: exactly one Incident exists for
  that business operation. **PASS.**
- **Case 2 (crash after the ServiceNow call, before local completion):**
  `acquireOperation()` followed by a real `createOnboardingIncident()`
  call (INC0010034 actually created), with `completeOperation()`
  deliberately skipped, simulating OB-0018's other crash boundary.
  Recovery reclaimed it, reconciliation found the existing Incident, and
  recorded completion against it rather than creating a second one.
  Independently verified: still exactly one Incident, matching the
  original `sys_id`. **PASS.**
- **Case 3 (concurrent reclaim of the same stale operation):** two
  concurrent calls to `recoverStaleDistributorOnboardingOperation()` for
  the same business operation, fired via `Promise.all` through the real,
  shared, module-singleton store (not the experiment's per-call-opened
  handle). Exactly one call reclaimed (`reclaimed: true`); the other
  correctly saw `reclaimed: false` and never contacted ServiceNow at
  all. Exactly one Incident (INC0010035) resulted, independently
  verified. **PASS** - OB-0021's concurrent-reclaim property survives
  the production extraction, including the connection-reuse difference
  from the experimental version.

**Replay/checkpoint behavior confirmed unregressed again:** ran the real
subscriber, published a fresh event, confirmed normal processing and a
saved checkpoint; restarted it and confirmed it resumed
`ReplayPreset.CUSTOM` from exactly that checkpoint with no reprocessing.
Recovery is invoked as a separate, explicit call in this round (see
FL-0025) and touches neither `pubsubClient.ts` nor `checkpoint.ts`, so
this was expected, not just hoped for.

**What this round deliberately did not build, per ADR 0005's and this
round's explicit scope:** anything that invokes recovery automatically
(a scheduled worker, a trigger tied to the audit tool's `GAP`
classifications), heartbeat/fencing, Tier 2, and - explicitly - any
attempt at OB-0022's slow-owner race. `reclaimOperation()`'s "stale"
still means "eligible for recovery under the caller's policy," not
"proven dead"; a genuinely slow-but-alive original owner remains just
as reclaimable, and just as capable of producing a duplicate on its own
delayed completion, as before. See FL-0024 and FL-0025 for new
implementation friction this round exposed.

---

### OB-0027: Where should Tier 1 recovery get its payload from? Source-owned wins on evidence; a minimal durable reference is more expensive than it looks

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1) - bounded investigation, not implementation
**Category:** architecture investigation

Bounded follow-up to FL-0024 (recovery needs the original event, but
`idempotencyStore.ts` deliberately never stores one). Not a reliability
redesign - ADR 0005 and the recovery mechanism from OB-0026 stand
unchanged. Compared three approaches to where Tier 1 should source a
recovering operation's business payload, using two direct experiments
(`scripts/test-recovery-payload-source.ts`,
`npm run test-recovery-payload-source`) rather than reasoning from the
API docs alone.

**Part 1 - Approach A (source-owned): can a bare business-operation ID
be mapped back to its source event, using only what durable state
already provides?** Published one real Salesforce event, reproduced the
exact "acquired locally, crashed before ServiceNow" precondition from
OB-0026's Case 1 (`acquireOperation()` only), then discarded all
in-memory knowledge of the event except its correlationId - exactly
what a real recovering process would have. A full `ReplayPreset.EARLIEST`
sweep (the same mechanism `detect-unprocessed-events.ts` already uses),
filtered client-side for that one correlationId, found it: 14 total
retained events swept, 8598ms, to locate 1. Confirmed directly from
`src/salesforce/proto/pubsub_api.proto`'s `FetchRequest` message (which
has exactly `topic_name`/`replay_preset`/`replay_id`/`num_requested` -
no filter field of any kind, across every RPC the API exposes) that no
server-side query-by-field mechanism exists to do this more cheaply.
This project has still never established Salesforce's actual retention
window for this topic (FL-0013 stands - `GetTopic` exposes none) - so
while relocation worked today, whether an older stale operation's event
would still be retrievable by the time recovery actually runs remains
genuinely unknown, not assumed either way.

**Part 2 - Approach C (minimal durable reference): would persisting an
event's own replay ID actually let you refetch that event later?**
Published event A then event B in sequence, captured A's own replayId,
then called `replayRange(topic, replayIdA)`. Result: 1 event returned -
event B, not event A. **Confirmed directly, not just from the proto's
documentation comment** ("specify the subscription point to start
after"): replaying from an event's own replay ID returns whatever comes
*after* it, never the event itself. A durable reference sufficient to
refetch operation X's own event would have to be the position
*preceding* X, not X's own ID - and nothing in this project captures a
per-operation preceding position today (`checkpoint.ts` tracks exactly
one global last-processed position for the whole stream, overwritten on
every event, not a snapshot taken before each individual operation).

**Comparison, all three approaches, against the requested dimensions:**

| | A: source-owned (replay on demand) | B: integration-owned (persist payload) | C: minimal durable reference (persist a position) |
|---|---|---|---|
| Recover after restart | Yes - confirmed (Part 1) | Yes, trivially (no dependency) | Not with the naive reference (Part 2) - a correct one needs a preceding position, not built |
| Depends on Salesforce replay/retention | Yes, fully - and that retention window is still unestablished (FL-0013) | No | Yes, fully - same retention risk as A |
| Locate one specific operation | Yes, but full-topic-history sweep, O(all retained events), not O(1) | Yes, O(1) - same `PRIMARY KEY` lookup already used today | Yes, and cheaper than A *if* a correct preceding-position reference existed - it doesn't yet |
| Payload/schema evolution | None - Salesforce remains sole owner of the event shape | Real - stored payload would need versioning as `DistributorOnboardingRequestedEvent` evolves; recovery could then be replaying an old shape against newer code | None - no payload stored |
| Storage responsibility | Unchanged - stays entirely with Salesforce | New - `idempotencyStore` or a sibling abstraction would durably duplicate business data Salesforce already owns | Small new column, but capturing the *right* value requires new per-operation plumbing beyond "add a column" |
| Coupling (generic reliability ↔ Salesforce) | Low for the store itself; the coupling already exists at the *recovery caller* today (FL-0024), unchanged by this | New - the store would need to know what "the payload" means, likely per business-event-type, eroding the target/source-agnostic boundary DP-0003/DP-0007 named as a real, already-observed benefit | New, differently - a replay-ID column bakes a Salesforce-specific addressing concept into a store that today knows about no particular source at all |
| Developer-facing complexity | Sweep-and-filter logic already exists (the audit tool); cost grows with total topic history over the project's lifetime, unbounded today | Simple at recovery time; genuinely new decisions and code at acquire time (what to store, how to version it, where it lives) | Needs new capture-at-acquire-time plumbing (the preceding position, not the event's own) that doesn't exist anywhere in this codebase yet |

**Recommendation: Approach A (source-owned).** It requires no code or
schema change, reuses tooling already built and validated
(`replayRange`, the same mechanism the audit tool depends on), and
preserves the target/source-agnostic boundary this project has already
found valuable twice (DP-0003, DP-0007). Its real cost - a full-topic
sweep with an unknown retention ceiling - is a genuine, open
operational risk, but one this project has not yet experienced as an
actual problem (14 events, ~2 months in): per `CLAUDE.md`'s own
principle, that is a reason to observe it, not to pre-emptively design
around it with Approach B's payload duplication or Approach C's
leakier, unbuilt reference mechanism. Approach C in particular looked
cheap before this investigation and is now known, by direct experiment
rather than assumption, to require real new plumbing to work correctly
- it is not simply "store one more field."

**This constitutes a material architectural decision ADR 0005 did not
address** - ADR 0005 decided the reliability *guarantee* tier structure,
not where a Tier 1 recovery caller should source its payload from. A
small follow-up ADR is recommended before this is actually implemented
(i.e., before an automatic GAP → recovery trigger is built), so the
choice is recorded deliberately rather than settled implicitly by
whichever code happens to get written first - not written this round.

**Follow-up:** written as
[ADR 0006](../decisions/0006-tier1-recovery-payload-sourcing.md) -
formalizes the Approach A recommendation above, records what it does
and does not guarantee, and defines the `GAP`-on-unlocatable-event
behavior. Still not implemented; see the ADR's own "Next step."

**What this round did not do, per its explicit scope:** connect the
audit tool to recovery automatically, implement Approach B or C, or
change any existing production code path (the only new code is the
diagnostic script above; `idempotencyStore.ts`,
`recoverStaleDistributorOnboardingOperation.ts`, and
`incidentReconciliation.ts` are all unchanged from OB-0026).

---

### OB-0028: The audit tool and the production recovery function were composed under an explicit opt-in switch - GAP recovers, DUPLICATE never does, unrecoverable GAPs stay GAP

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0006's own recommended next step)
**Category:** implementation / verification

Implements ADR 0006's "Next step" exactly as scoped: connects
`scripts/detect-unprocessed-events.ts`'s existing `GAP` classification
to `recoverStaleDistributorOnboardingOperation()` (OB-0026), still
manually triggered, no scheduler, no automatic background recovery.

**Changes, both small:** `src/salesforce/subscriber.ts`'s
`toCanonicalEvent()` mapping is now exported, so the audit script reuses
the exact same raw-payload-to-canonical-event mapping recovery expects
instead of a second, drifting copy of it. `detect-unprocessed-events.ts`
gained an explicit `--recover=<staleAfterMs>` mode - bare `--recover`
with no value is rejected outright rather than defaulted, since ADR
0005 already named the staleness threshold an operational tuning knob
this project hasn't chosen a production value for. Without `--recover`,
the script's behavior is byte-for-byte what it was before this round -
audit-only, read-only, no ServiceNow writes. `src/reliability/idempotencyStore.ts`,
`recoverStaleDistributorOnboardingOperation.ts`, and
`incidentReconciliation.ts` are all untouched - the composition lives
entirely in the script, reusing all three unchanged.

**End-to-end evidence, all three cases run through the real,
unmodified CLI as a subprocess (`npm run test-audit-recovery-composition`,
which shells out to `npx ts-node scripts/detect-unprocessed-events.ts --recover=<ms>`
exactly as an operator would invoke it):**

- **Case 1 (recoverable GAP):** acquired locally, no ServiceNow call
  (OB-0026's Case 1 shape). Classified `GAP`, then `RECOVERED` in the
  same run (`foundExisting=false`, Incident INC0010040 created).
  Independently verified: exactly one Incident in ServiceNow, local
  state `completed`. A re-audit immediately afterward classified it
  `OK`. **PASS.**
- **Case 2 (unresolvable GAP - never acquired locally):** published,
  no local durable record at all. Classified `GAP`, then
  `NOT RECOVERED` (`reclaimOperation` found no row to reclaim).
  Independently verified: zero Incidents, local state `null` (recovery
  created nothing). A re-audit immediately afterward still classified
  it `GAP` - **recovery being requested did not mark an unresolved GAP
  as completed.** **PASS.**
- **Case 3 (DUPLICATE):** two real Incidents created directly for the
  same correlationId, no local durable record. Classified `DUPLICATE`;
  no `RECOVERED`/`NOT RECOVERED` line was ever printed for it - recovery
  was never invoked, by construction (the branch is `classification ===
  'GAP' && recover`, not a runtime check on top of a broader routing
  path). Independently verified: still exactly two Incidents (no third
  created), local state still `null`. A re-audit afterward still
  classified it `DUPLICATE`, unchanged. **PASS.**

**A fourth, unplanned but real recovery happened in the same run:**
`b6c91d35-bccb-48a5-b393-7555fe297376`, a genuinely stale `in_flight`
local record left over from OB-0027's own experiment (acquired in an
earlier session, never completed), was swept up by the same
`EARLIEST` replay, classified `GAP`, and correctly recovered
(INC0010039) - real evidence that recovery works on state that's
actually old, not just freshly created within the same test run.

**A genuine, previously-unknown operational quirk was also found and
corrected before it became a false claim:** the very first
`detect-unprocessed-events` invocation this round (audit-only, no
`--recover`) returned **0 events**, immediately after a real topic
existence check (`get-topic-info`) confirmed the topic itself was fine.
This looked, briefly, like Salesforce retention expiry - exactly the
unestablished risk ADR 0006 names. Rerunning the exact same sweep
minutes later (inside this round's harness) reliably returned all 19
retained events, including ones from earlier sessions. **This was not
retention expiry** - most likely a cold-start artifact of the gRPC
`Subscribe` stream's connection warmup racing `replayRange`'s
`windowMs` timer on a fresh process's very first call, not investigated
further this round (out of scope). Recorded as FL-0026 - a real,
reproducible-looking "nothing to audit" result can be a false negative,
not evidence of an empty topic, and should be re-checked before being
trusted, especially now that `--recover` mode makes "collected 0
events" also mean "no recovery attempted."

**DUPLICATE and other non-GAP classifications:** confirmed unchanged by
this round for every classification this run observed among the full
19-event history (`OK`, `DUPLICATE`, `UNEVALUABLE` all behaved exactly
as they did before `--recover` existed) - the new branch is additive,
gated on `GAP`, not a change to classification logic itself.

**Checkpoint/replay behavior confirmed unregressed:** ran the live
subscriber, published a fresh event, confirmed normal processing and a
saved checkpoint; restarted it and confirmed it resumed
`ReplayPreset.CUSTOM` from exactly that checkpoint with no reprocessing.

**What this round did not build, per its explicit scope:** any
scheduler or cron trigger, automatic/background recovery, a retry loop,
heartbeat/fencing, Tier 2, automatic duplicate remediation, or anything
addressing OB-0022's slow-owner race. See FL-0026 and FL-0027 for new
implementation/operator friction this round exposed, and
`docs/devex/dojo-perspectives.md` DP-0017 onward for what this
composition looked like from each DevEx Dojo role.

---

### OB-0029: Before scheduling recovery, a bounded policy design asks what automation would actually be allowed to do — ADR 0007 decides the contract, not a scheduler

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (bounded operational-policy design)
**Category:** architecture / operational policy

OB-0028 proved the manual audit/recovery composition works end-to-end.
The obvious next move - schedule it - was deliberately not taken.
Automating `--recover=<staleAfterMs>` converts a value a developer
currently types with judgment attached into a standing platform policy
governing when ownership may be taken from a possibly-still-live worker
(OB-0022). This round asked what has to be true before that conversion
is safe, without building the thing that would need it.

[ADR 0007](../decisions/0007-tier1-scheduled-recovery-operational-contract.md)
records the answer as a contract, not a number: cadence and
`staleAfterMs` both require evidence this project doesn't have yet
(measured latency, measured sweep-anomaly frequency) and are
**explicitly not derived from the 2000ms experimental value** used
throughout OB-0020 through OB-0028. Overlapping runs are resolved as a
load/observability concern (skip-if-running), not a correctness one -
the atomic reclaim gate already prevents double-recovery of the same
operation regardless of scheduling (OB-0017, OB-0021 Case 3, OB-0026
Case 3, OB-0028). A zero-event sweep (FL-0026) must gate out mutating
recovery for that run rather than being read as a confirming "nothing
to recover" result. Failure handling relies on the next scheduled run
as the retry, explicitly dependent on today's full-history resweep
behavior (no internal retry logic invented). Most notably: **audit and
recovery must be independently schedulable, and the existing
`--recover=<ms>` flag interface already provides that separation for
free** - no refactor of `detect-unprocessed-events.ts` is required
despite FL-0027's growing-responsibility concern, because ADR 0005's
mandatory detection requirement must not be blocked on evidence
recovery automation still needs.

**Recommends the smallest next automation slice: schedule audit-only,
not recovery.** It satisfies ADR 0005's mandatory floor immediately, at
zero mutation risk, and is also how this project would gather the
latency/anomaly-frequency evidence ADR 0007 requires before scheduled
recovery could be responsibly proposed at all - not a smaller version
of the eventual goal, but the actual prerequisite for it.

**Nothing was implemented this round** - no scheduler, no
configuration mechanism for `staleAfterMs`, no refactor of the audit
script, no change to any of the mechanisms OB-0028 verified.

---

### OB-0030: Tier 1's mandatory detection can run unattended, non-mutating, and observable — ADR 0007's audit-only contract operationalized, two real bugs found by testing the failure paths, not by reading code

**Date:** 2026-09-17
**Phase:** Phase 1 — Enablement (ADR 0007's recommended next step)
**Category:** implementation / verification

Answers ADR 0007's recommended next step directly: can Tier 1's
mandatory detection run unattended, produce useful evidence, and fail
observably, without ever touching ServiceNow? **Yes, confirmed against
real Salesforce and ServiceNow, repeatedly, including under a genuine
failure.**

**Scheduling mechanism: cron + `flock`, an existing OS mechanism, not a
new framework.** `scripts/ops/run-scheduled-audit.sh` is the
cron-invokable wrapper; it runs `npm run detect-unprocessed-events`
with **no arguments, ever** - `--recover` cannot appear, hardcoded, not
passed through from any caller-supplied argument. `detect-unprocessed-events.ts`
itself gained two small, additive changes: `checkSweepHealth()` (ADR
0007 §4 / FL-0026) treats a zero-event sweep as an unhealthy run and
exits before classification or recovery can run at all; a single
`RUN_SUMMARY:` JSON line at the end of a successful run reports mode,
timing, and classification counts. Per-`GAP` lines also report `ageMs`
(from the event's own `CreatedDate`) and, when a local durable record
exists, `localDwellMs` (from `idempotencyStore.ts`'s existing
`acquiredAt`) - non-mutating evidence for the cadence/threshold
decisions ADR 0007 deferred, using only timestamps that already existed
(no new state added anywhere).

**Non-mutation, established independently, not assumed:** the local
`.idempotency.sqlite` store's row count (13) and full contents were
byte-identical before and after every one of this round's real,
unattended audit runs; ServiceNow's total Incident count (112) was
identical before and after. Across roughly seven successful runs, one
skipped run, and one deliberate failure, **zero Incidents were created
or modified and zero local durable records changed.**

**Overlap:** two wrapper invocations fired concurrently - the first
completed a real ~20-second audit; the second, started 2 seconds later,
exited immediately (`exitCode=75`, `status=skipped`) via `flock -n`,
logged distinctly in `.audit-runs.jsonl`. No double Salesforce sweep, no
double ServiceNow query pass.

**Failure:** a deliberately invalid `SERVICENOW_CLIENT_SECRET` (passed
as a one-off environment override, never touching the real `.env`)
produced a genuine ServiceNow OAuth failure partway through
classification. The run failed loudly (`exitCode=1`), and a subsequent
normal invocation immediately afterward succeeded cleanly - no lock
left held, no internal retry attempted, exactly ADR 0007 §8's contract.

**The zero-event anomaly guard was verified directly, not by fabricating
a live Salesforce zero-event sweep** (not safely producible - retention
is still unestablished per ADR 0006, and forcing it would either risk
real data loss or require inventing a scenario this project can't
actually distinguish from a genuine anomaly). `checkSweepHealth(0)` and
`checkSweepHealth(20)` were called directly and confirmed to branch
correctly - an honest, narrower verification than a live-fired scenario,
reported as exactly that.

**Two real implementation bugs were found only by exercising the actual
failure/import paths, not by reading the code (FL-0028, FL-0029,
FL-0030):**

- The wrapper's first version dynamically resolved `node` via
  `command -v`, which under a simulated cron-minimal PATH
  (`env -i PATH=/usr/bin:/bin`) silently found the *wrong* Node (system
  Node 18, no `node:sqlite` support) rather than failing to find one -
  confirmed by directly reproducing the exact failure
  (`ERR_UNKNOWN_BUILTIN_MODULE`) before fixing it with an explicit,
  hardcoded, commented path (FL-0028).
- The wrapper's `RUN_SUMMARY:` extraction used `grep -o ... | tail -n1`
  under `set -e`/`pipefail`; on a failed run (no such line exists),
  `grep`'s own "no match" exit code silently terminated the *wrapper*
  before it could log the failure - found only by actually exercising a
  failure and checking the log came back empty (FL-0029).
- Adding `checkSweepHealth` as an export triggered an unplanned real
  Salesforce/ServiceNow run, because `detect-unprocessed-events.ts`
  called `main()` unconditionally at import time - fixed with the
  standard `require.main === module` guard (FL-0030).

**Provisional cadence:** none chosen or hardcoded anywhere. The
cron schedule field itself is the configuration point - documented in
the wrapper's own usage comment as an explicitly labeled, editable
example for the evidence-gathering period, not a recommendation.
`staleAfterMs`/scheduled recovery remain entirely untouched, per ADR
0007's scope for this step.

**What this round did not build, per its explicit scope:** scheduled
recovery, automatic GAP remediation, a production `staleAfterMs`,
heartbeat/fencing, Tier 2, an incremental replay position, automatic
`DUPLICATE` remediation, and no broad refactor of
`detect-unprocessed-events.ts` (two additive checks and one guard, not
a restructuring). The crontab entry itself was not installed as a
standing, persistent system change - the wrapper was verified by direct
invocation (exactly as cron would invoke it), with the exact crontab
line documented for the operator to add deliberately.

---

### OB-0031: Audit-only installed as a standing hourly job, on explicit instruction — first genuine cron-triggered execution independently confirmed

**Date:** 2026-09-17
**Phase:** Phase 1 — Enablement (ADR 0007's evidence-gathering period)
**Category:** implementation / verification / operations

OB-0030 proved the audit-only wrapper correct by direct invocation, but
deliberately did not install a standing crontab entry - a persistent,
system-level change requiring an explicit human decision, not something
to take unilaterally. That decision was made explicitly this round:
install `0 * * * *` (hourly) as ADR 0007's provisional evidence-gathering
cadence - not a chosen Tier 1 audit SLA, not recovery policy.

**Installation confirmed via the actual installed configuration, not
just the repository example:** `crontab -l` was read back after
installing and shows exactly the intended entry; `systemctl is-active
cron` / `journalctl -u cron` confirm the cron daemon itself is active
(running since the prior day, PID 1007). A reference copy of the
installed crontab lives at `scripts/ops/crontab-hourly-audit.txt` -
documentation of what's running, not something applied automatically.

**The first genuine, cron-triggered execution was independently
confirmed from three separate sources, not just the wrapper's own
self-report:**

- `/var/log/syslog` and `journalctl -u cron`: `CRON[453155]: (rgoodin)
  CMD (.../run-scheduled-audit.sh ...)` fired at `07:00:01`, PAM
  session closed at `07:00:30` - cron's own daemon log, external to
  anything this project's code writes.
- `.audit-cron.log`: the real captured stdout/stderr from that exact
  invocation.
- `.audit-runs.jsonl`: `{"wrapperStartedAt":"2026-09-17T14:00:01.844Z",
  ...,"status":"ok","exitCode":0,"scriptRunSummary":{"mode":"audit",
  ...,"eventsExamined":20,"classifications":{"UNEVALUABLE":1,"GAP":3,
  "OK":12,"DUPLICATE":4},"recovery":null,"success":true}}` - a
  ~29-second run, structurally identical to every manually-invoked run
  in OB-0030, this time triggered by nobody.

This is explicitly distinguished from every prior test: OB-0030's
verification ran the wrapper directly, exactly as cron *would*; this is
the first time cron actually did, unprompted, at the literal scheduled
time, confirmed by a log this project's own code has no ability to
fabricate. The schedule was not accelerated to manufacture additional
observations, and none are claimed beyond this single, genuine
execution - inferring cadence or threshold policy from one data point
would be exactly the mistake ADR 0007 exists to prevent.

**Non-mutation held under real unattended execution, not just
simulated/manual testing:** the local durable store's row count (13)
and ServiceNow's total Incident count (112) were identical immediately
after this cron-triggered run, matching every prior measurement in
OB-0030.

**Evidence retention:** three plain files under
`services/integration-service/` (`.audit-runs.jsonl` structured,
`.audit-cron.log` raw/cumulative, `.audit-last-run.log` raw/latest-only),
all gitignored. No monitoring stack, metrics platform, database, or
dashboard was introduced - explicitly out of scope, and unnecessary for
an evidence-gathering period whose entire consumer, for now, is a human
periodically reading a log file.

**Operator documentation added**
(`services/integration-service/README.md`, "Operating the scheduled
audit"): where the schedule lives, where results land, how to
distinguish `ok`/`skipped`/`sweep_anomaly`/`failed`, what exit 75
means, how to run the audit manually, how to disable the schedule, and
why `--recover` is deliberately absent from every scheduled invocation.

**No new operational friction surfaced this round** - installation and
the first firing both matched OB-0030's verified behavior exactly, with
no code changes required or made.

**What this round did not do, per its explicit scope:** choose a
production `staleAfterMs`, schedule recovery, make the recovery-cadence
decision, or infer any policy from this single observed run. The system
is left running at the hourly observation cadence; the next decision
point is whichever round chooses to analyze accumulated
`.audit-runs.jsonl` evidence, not this one.

---

### OB-0032: A real Microsoft 365 tenant, SharePoint site, and least-privilege Azure AD app registration are live — Developer #2's Configure step, done, not simulated

**Date:** 2026-09-18
**Phase:** Phase 5 — Second Consumer (Salesforce → SharePoint)
**Category:** environment setup / authentication / secrets

Per the "all the way live" scoping decision, Developer #2's Configure
step was performed against real Microsoft services, not stubbed:

- **Tenant:** a Microsoft 365 Business Basic trial (`goodintechnologysolutions.onmicrosoft.com`),
  provisioned after the Developer Program path was found ineligible
  (FL-0032). MFA configured on the admin account.
- **SharePoint site:** `Distributor Workspaces`
  (`/sites/DistributorWorkspaces`), a Standard-template Team site with
  its default Documents library — created specifically for this
  integration rather than reusing the tenant's default site, so the
  least-privilege app-permission grant below has a single, deliberate
  target. Site's Graph composite ID confirmed via the SharePoint REST
  API (`_api/site/id` + `_api/web/id`, composed as
  `<hostname>,<site-collection-id>,<web-id>`) once the modern SharePoint
  REST/Graph ID mismatch was worked around.
- **Azure AD app registration:** `Golden Vine Document Workspace
  Service`, single-tenant, with a client secret (180-day expiry) and
  the Microsoft Graph **application** permission `Sites.Selected`
  (admin-consented at the tenant level).
- **Site-level grant:** the app was given `write` access to exactly the
  `Distributor Workspaces` site via `POST /sites/{id}/permissions`
  (`grantedToIdentities` → this app's id/displayName), run through
  Graph Explorer under a delegated `Sites.FullControl.All` consent held
  only for this one bootstrap call (FL-0033). Confirmed via the live
  `201 Created` response, not assumed from the request succeeding
  silently.

This is the direct SharePoint analog of ADR 0004's ServiceNow
Client-Credentials setup: a dedicated, narrowly-scoped machine identity,
not a shared or administrative one. Two real asymmetries with the
Salesforce/ServiceNow setups were surfaced doing this, not anticipated
in advance — see FL-0032 (Developer Program eligibility) and FL-0033
(the `Sites.FullControl.All` bootstrap requirement) for what they were
and why they mattered.

**What this round did not do:** write any service code, choose the
distributor-folder naming/identity scheme, or decide anything about
reconciliation or reliability behavior for this target — those are
Create-step decisions, not Configure-step ones, and are explicitly
deferred to keep this observation about the environment, not the
integration logic.

---

### OB-0033: SharePoint's audit tool needed a genuinely different solution shape than ServiceNow's - list-once-per-run, not query-once-per-event - and every branch was verified live, not assumed from the port

**Date:** 2026-09-18
**Phase:** Phase 6 — Iteration (`docs/devex/phase-6-iteration-review.md` Finding 4)
**Category:** implementation / verification

`services/document-workspace-service/scripts/detect-unprocessed-events.ts`
mirrors `services/integration-service`'s audit tool's two-mode shape
(audit-only, opt-in `--recover=<ms>`) and its classification model
(`GAP`/`OK`/`DUPLICATE`/`UNEVALUABLE`) exactly - but the actual
target-reconciliation mechanism underneath had to be genuinely
different, not a mechanical port:

**The real design fork.** ServiceNow has an indexed `correlation_id`
field, so its audit issues one filtered query per Salesforce event (N
events -> N ServiceNow calls, each returning an exact count). SharePoint
has no equivalent field - the only way to know what exists is to list
the folder and inspect names. Querying per-event here would mean N
Graph calls for N events, for no benefit. Instead,
`listWorkspaceFolders()` (`src/sharepoint/workspaceReconciliation.ts`)
calls SharePoint exactly **once per run**, and every event is
classified against that single in-memory snapshot. This also forced two
things a native-field query never has to handle: pagination
(`@odata.nextLink`, followed until exhausted) and the workspace root
folder not existing yet (a fresh site 404s on that path - treated as
zero folders, not a failure).

**Every branch verified live, against real Salesforce/SharePoint, not
assumed from the code reading correctly:**

- **GAP**: confirmed both from the real pre-existing history (20 events
  from before this service existed) and from a freshly published,
  deliberately-unprocessed event (`correlationId=81e63c71...`).
- **OK**: confirmed against a real folder created earlier this session.
- **DUPLICATE**: not naturally occurring - manufactured directly by
  creating a second real folder sharing an existing correlationId
  prefix (`a8f20e40...`), confirmed classified `DUPLICATE` with both
  folder names reported as evidence, then deleted to leave the site
  clean.
- **Recovery composition**: the fresh GAP was deliberately made
  reclaimable (`acquireOperation()` called directly, simulating a crash
  before completion, same technique `test-production-recovery.ts` uses),
  then `--recover=1000` correctly created the SharePoint folder and
  reported `RECOVERED`; a follow-up audit-only run reclassified it
  `OK` - the same GAP -> RECOVERED -> OK composition OB-0028 validated
  for ServiceNow, now confirmed for SharePoint too.
- **Empty-site/404 handling**: verified directly by pointing
  `listWorkspaceFolders()` at a deliberately nonexistent workspace
  folder name and confirming it returns `[]` rather than throwing.
- **The cron wrapper** (`scripts/ops/run-scheduled-audit.sh`, a
  deliberate mechanical duplicate of the ServiceNow version - see its
  own header comment for why duplication was judged correct here, not
  laziness) was run directly, exactly as cron would invoke it: exit 0,
  `status":"ok"` recorded in `.audit-runs.jsonl` with the same
  structured shape as the ServiceNow version's evidence.

**Not empirically tested:** pagination past the first page - this
project has no realistic way to create 200+ real SharePoint folders to
exercise it, so that specific branch is verified by code review against
Graph's documented `@odata.nextLink` contract, not by a live experiment.
Recorded honestly as a gap in evidence, not silently assumed working
(`docs/devex/phase-2-observation-review.md` Finding 15).

**What this round did not do:** install a standing cron schedule for
this new audit tool - that remains a separate, deliberate decision, the
same way it was for ServiceNow (OB-0031).

---

<!-- Add new entries above this line, most recent first. -->
