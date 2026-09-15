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

<!-- Add new entries above this line, most recent first. -->
