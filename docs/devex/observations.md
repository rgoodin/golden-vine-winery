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

<!-- Add new entries above this line, most recent first. -->
