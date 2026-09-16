# Friction Log

This log captures developer friction encountered while building the
Salesforce → ServiceNow integration (and later integrations). It exists to
surface problems worth solving *before* the platform automates them.

Per `CLAUDE.md`:

- Document friction first. Do not silently automate it away.
- Observation precedes enablement.
- Each meaningful friction item gets its own entry below, using the template.

See also `docs/devex/observations.md`, `docs/devex/decisions.md`, and
`docs/devex/lessons-learned.md`.

## How to use this log

1. When something is difficult, unclear, repetitive, risky, or slow, stop and
   capture it here before working around it.
2. Copy the template below for each new entry and fill it in.
3. Do not propose a fix as if it's already decided — "Possible Enablement" is
   a candidate, not a commitment.
4. Revisit this log during Phase 2 (Observation Review) to classify and
   prioritize entries.

---

## Template

### FL-XXXX: <short title>

**Date:** YYYY-MM-DD
**Phase:** <current DevEx Dojo phase, e.g. Phase 1 — Developer Experience>

#### Observation

What was the developer attempting to accomplish?

#### Friction

What made the task difficult, unclear, repetitive, risky, or slow?

#### Impact

What did the friction cost? (e.g. time, context switching, security risk,
configuration errors, cognitive load, repeated work)

#### Possible Enablement

What could the platform provide to remove or reduce the friction?

_Do not implement this automatically. Observation precedes enablement._

---

### FL-0001: Salesforce Pub/Sub API authentication and client setup is unresolved

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Scaffolding the integration service's Salesforce event subscriber, per
`docs/decisions/0001-integration-architecture.md` (Platform Event via
Pub/Sub API).

#### Friction

The Pub/Sub API is gRPC-based, not plain REST, and requires: choosing an
OAuth authentication flow (JWT bearer vs. username-password vs. web server
flow), obtaining Salesforce org credentials/certificates, the Pub/Sub API's
`.proto` definitions, and Avro schema decoding for the event payload. None of
this is set up yet, and the canonical event contract in `CLAUDE.md` doesn't
say what a minimal working example looks like.

#### Impact

The subscriber (`services/integration-service/src/salesforce/subscriber.ts`)
is currently a stub that throws "not implemented." This blocks proving the
first real event end-to-end, which is Phase 1's actual milestone.

#### Possible Enablement

Not decided yet — observation precedes enablement. Candidates to
investigate: a documented JWT bearer flow setup guide, a shared Pub/Sub gRPC
client wrapper, a dev-org creation runbook.

**Resolved 2026-09-15:** Implemented `src/salesforce/auth.ts` (JWT bearer
flow) and `src/salesforce/pubsubClient.ts` (gRPC client using Salesforce's
officially published `pubsub_api.proto`, fetched directly rather than
reconstructed from memory — see `src/salesforce/proto/`). Ran it against the
real dev org: authentication and the gRPC/TLS connection both worked on the
first attempt (confirmed by getting a topic-not-found error identifying our
actual org ID, rather than an auth error). The only remaining blocker is
that the `DistributorOnboardingRequested__e` Platform Event doesn't exist in
Salesforce yet — tracked as FL-0004.

---

### FL-0002: "Connected App" UI has been replaced by "External Client Apps"

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Following documented/typical steps to create a Connected App in Setup →
App Manager → "New Connected App" to configure JWT bearer auth for the
integration service.

#### Friction

This newly-created Developer Edition org has no "New Connected App" button.
Salesforce has replaced that flow with **External Client Apps** (Setup →
App Manager → "New External Client App"). The field layout differs from
older Connected App documentation/tutorials: OAuth settings live under a
collapsible "API (Enable OAuth Settings)" section with an "Enable OAuth"
checkbox, and JWT bearer setup is its own "Enable JWT Bearer Flow" checkbox
under "Flow Enablement" (rather than a single "Use digital signatures"
checkbox) which is what reveals the certificate upload field. The Consumer
Key/Secret are also not shown on the main detail page — they're under the
Settings tab → OAuth Settings → "Consumer Key and Secret" button, which
triggers an email identity-verification step before revealing them.

#### Impact

Generic/older Salesforce tutorials and AI-generated instructions based on
"Connected App" terminology don't match what a new Developer Edition org
actually shows. Cost: a few rounds of back-and-forth navigating Setup
together to find the right screen and re-derive the actual field layout.

#### Possible Enablement

Not decided yet. Candidate: a runbook/screenshot-annotated doc specific to
the External Client App flow, since this is likely to trip up every future
developer working from older Salesforce documentation.

---

### FL-0003: Consumer Key/Secret gated behind email identity verification

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Attempting to retrieve the Consumer Key for the newly created External
Client App, needed for the integration service's `.env`.

#### Friction

Clicking "Consumer Key and Secret" doesn't show the values directly — it
opens a "Verify Your Identity" page requiring a one-time code emailed to
the org's contact email. This is a manual, human-in-the-loop step that
can't be automated or skipped, and isn't mentioned in the App Manager UI
until you click through.

#### Impact

Minor delay (checking email, entering code) but blocks any attempt to
script/automate credential retrieval end-to-end.

#### Possible Enablement

None needed — this is expected security behavior, not a gap to fix. Worth
documenting so future developers aren't surprised by it.

---

### FL-0004: DistributorOnboardingRequested__e Platform Event doesn't exist yet

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Ran the newly-implemented Pub/Sub subscriber (`npm run dev`) against the
real dev org to test it end-to-end.

#### Friction

Not really friction — this is the expected next gap. Auth and the gRPC
connection both worked; the Subscribe call failed because
`/event/DistributorOnboardingRequested__e` doesn't exist in Salesforce yet.
We only ever set up authentication, never created the Platform Event
object/fields.

#### Impact

Can't prove an event end-to-end (Phase 1's actual milestone) until the
Platform Event exists and something publishes a test event.

#### Possible Enablement

Not decided yet. Next step is simply to create the Platform Event object
and its fields in Setup, then publish a test event (via Setup's UI or the
REST API) and confirm the subscriber logs it.

**Resolved 2026-09-15:** Created the Platform Event and one field
(`Distributor_Name__c`) in Setup, then published a test event via a small
REST-API script (`scripts/publish-test-event.ts`) and confirmed the
subscriber logged it in real time. Full event flow proven end-to-end.

---

### FL-0005: JWT `aud` claim must be the fixed login host, not the org's My Domain URL

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Implementing the JWT bearer flow assertion in `src/salesforce/auth.ts`.

#### Friction

It's tempting to set the JWT `aud` claim to the org's own My Domain URL
(`SALESFORCE_LOGIN_URL`, used as the token endpoint) since that's the
"Salesforce URL" already in config. Per Salesforce's JWT Bearer Flow spec,
`aud` must instead be a fixed value per environment type —
`https://login.salesforce.com` for production/Developer Edition,
`https://test.salesforce.com` for sandboxes — regardless of the org's
custom domain. Using the My Domain URL as `aud` would likely produce an
"audience mismatch" error.

#### Impact

Would have cost a confusing auth failure and debugging round-trip if not
caught before the first real test run.

#### Possible Enablement

Addressed directly: added a separate `SALESFORCE_JWT_AUDIENCE` config value
(defaulting to `https://login.salesforce.com`) distinct from
`SALESFORCE_LOGIN_URL`, with a comment explaining the distinction.

---

### FL-0006: Platform Event API name doesn't default to PascalCase

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

After creating the `Distributor Onboarding Requested` Platform Event and
leaving API Name on its auto-filled value, the subscriber still got
"topic ... not found" even after waiting.

#### Friction

Salesforce auto-generates the API Name from the Label by replacing spaces
with underscores, producing `Distributor_Onboarding_Requested__e` - not
`DistributorOnboardingRequested__e` as assumed (matching the PascalCase
`eventType` field name used in the conceptual payload in `CLAUDE.md`). The
mismatch looked exactly like a propagation-delay issue at first (same
"topic not found" error), which cost a wasted retry before checking the
actual API Name on the object's detail page.

#### Impact

One extra round-trip (re-running the subscriber, then asking the developer
to confirm the exact API Name) before finding the real cause.

#### Possible Enablement

Addressed directly: `SALESFORCE_PUBSUB_TOPIC` in `.env`/`.env.example` and
the default in `config.ts` were updated to match Salesforce's actual name,
with a comment warning not to assume PascalCase. General lesson: always
confirm exact API names from the org rather than deriving them from a
Label or a conceptual/example payload.

---

### FL-0007: ServiceNow's classic "Application Registry" superseded by "Machine Identity Console"

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Looking for where to create an OAuth integration in ServiceNow to
authenticate the integration service.

#### Friction

The classic path (System OAuth → Application Registry → New) still exists
and works, but the list page itself banners "Introducing New Inbound
Integration Experience" pointing to a completely different UI - the
**Machine Identity Console** (`/now/machine-identity-console/...`), which
presents grant types (Authorization Code, Client Credentials, JWT Bearer,
Resource Owner Password Credentials) as explicit named choices up front,
unlike the classic form. Easy to miss the banner and build against the
older, less-guided classic form instead. Same pattern as Salesforce's
Connected App → External Client App shift (FL-0002).

#### Impact

None this time - the banner was caught before building anything in the
classic UI. Worth flagging so future developers don't default to outdated
tutorials/screenshots for ServiceNow OAuth setup either.

#### Possible Enablement

Not decided. Same candidate as FL-0002: a living, UI-current setup doc
rather than static screenshots.

---

### FL-0008: OAuth Client Credentials grant is disabled by default, with no auto-fix

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Starting a new "OAuth - Client credentials grant" integration in the
Machine Identity Console.

#### Friction

The very first thing the form shows is a banner: "For client credential
grants to work, property
'glide.oauth.inbound.client.credential.grant_type.enabled' must be defined
and set to true." Checking System Properties confirmed the property didn't
exist at all in this fresh Developer Instance - not merely set to false.
The UI lets you fill out and save the entire integration anyway, without
this being enforced or auto-created.

#### Impact

Would have resulted in a created-but-non-functional integration if the
banner had been missed or dismissed without action.

#### Possible Enablement

Addressed directly: created the system property (boolean, `true`) via
System Properties → New before continuing, with the developer's explicit
go-ahead since it's a platform-wide security switch, not scoped to one
app. General lesson: a "New" form allowing you to save a broken
configuration, with the fix documented only in a dismissible banner, is a
sharp edge worth watching for on any platform.

---

### FL-0009: "OAuth application user" picker searches by first name, not user ID

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Selecting the dedicated `golden.vine.integration` user in the Client
Credentials grant form's "OAuth application user" field.

#### Friction

Typing the actual username (`golden.vine`) into the picker returned "No
results found." Typing the first name (`Golden`) found it immediately.
The field's autocomplete apparently matches display name, not User ID -
counterintuitive for a field whose purpose is identity, and easy to
wrongly conclude the user wasn't created successfully.

#### Impact

A few seconds of confusion/re-verification (re-checked the user actually
existed via the Users list) before trying a different search term.

#### Possible Enablement

None needed structurally - just worth documenting the actual search
behavior so the next developer doesn't repeat the same false alarm.

---

### FL-0010: `useraccount` Auth Scope silently disables API-level restriction

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Configuring the Auth Scope for the Client Credentials integration, trying
to restrict it to just the Incident Table API via "Limit authorization to
the following APIs."

#### Friction

`useraccount` was the only Auth Scope available (a fresh instance has no
custom scopes). Selecting it disables "Limit authorization to the
following APIs" entirely - the UI shows "Disabled: useraccount scope
already grants access to all signed-in user resources" - along with a
warning that the scope "is not recommended for most integrations." There
is no way to get meaningful API-level restriction without first using
"Create auth scope" to define a custom one.

#### Impact

The token's real access boundary ended up being the dedicated user's
`itil` role (ACLs/business rules), not the OAuth scope itself, which is a
weaker defense-in-depth story than intended. Documented as a known gap
rather than solved, per ADR 0004.

#### Possible Enablement

Not pursued yet. Candidate: create a custom Auth Scope limited to the
Incident Table API if/when this integration needs tighter guarantees than
"whatever the itil role allows."

---

### FL-0011: Duplicate Salesforce events create duplicate ServiceNow Incidents

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Deliberately tested what happens on duplicate delivery, per `CLAUDE.md`'s
own Developer #1 question "How do I prevent duplicate processing?" —
published the same event (same `Event_Id__c`/`Correlation_Id__c`) twice in
a row via `scripts/publish-test-event.ts`.

#### Friction

Both publishes succeeded, and the subscriber created **two separate
ServiceNow Incidents** (`INC0010002`, `INC0010003`) for what should be the
same logical event — confirmed via `scripts/verify-recent-incidents.ts`.
There is currently no idempotency check anywhere in the chain: not on
receipt (no dedup by `eventId`/`replayId`), and not on the ServiceNow side
(Incident creation doesn't check for an existing Incident with the same
`correlation_id` first).

#### Impact

In a real deployment, any at-least-once redelivery from Salesforce's
Pub/Sub API (which is exactly the guarantee it makes - see the official
proto's comments on `replay_id`) would silently create duplicate
operational work in ServiceNow every time.

#### Possible Enablement

Not decided yet — observation precedes enablement. Candidate: before
creating an Incident, query ServiceNow for an existing one with the same
`correlation_id` and skip/short-circuit if found. Would need to weigh
against a proper replay-ID-based dedup on the Salesforce side instead.

---

### FL-0012: A single ServiceNow failure crashes the entire subscriber process, losing all subsequent events

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Deliberately tested what happens when ServiceNow is unreachable, per
`CLAUDE.md`'s own Developer #1 question "What happens when ServiceNow is
unavailable?" — ran the subscriber with `SERVICENOW_INSTANCE_URL`
overridden to an invalid address, then published a real Salesforce event.

#### Friction

The ServiceNow `fetch` call failed as expected, but the error wasn't
caught anywhere - the `async` event handler passed to `stream.on('data', ...)`
in `pubsubClient.ts` threw, which isn't captured by the gRPC stream's
`'error'` handler (that only fires for stream-level errors, not
exceptions thrown inside a `'data'` listener). The result was an unhandled
promise rejection that **crashed the entire Node process** - confirmed via
`ps aux` after the fact.

#### Impact

This is more severe than "this one event fails": because the subscriber
uses `ReplayPreset: LATEST` with no replay-ID checkpointing (see
`src/salesforce/pubsubClient.ts`), a crashed-and-unnoticed process means
every Salesforce event published while it's down is **permanently lost**,
not merely delayed - there's nothing to replay from once it restarts.
This also means one flaky ServiceNow call can silently stop the entire
integration, not just the one record it was handling.

#### Possible Enablement

Not decided yet — observation precedes enablement. Candidates to weigh:
catching/logging errors per-event instead of letting them propagate and
kill the process; storing the `latest_replay_id` from each `FetchResponse`
so a restart can resume with `ReplayPreset: CUSTOM` instead of `LATEST`;
some combination of retry-with-backoff and dead-lettering for
ServiceNow-side failures specifically.

---

### FL-0013: `GetTopic` does not expose retention/replay-window information — corrects an earlier unverified assumption

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Investigating Salesforce Pub/Sub API behavior before building the replay
checkpoint experiment (per `docs/devex/lessons-learned.md` LL-0007's
recommended next step), specifically to check whether `TopicInfo` exposes
a retention policy - rather than assuming.

#### Friction

`docs/devex/lessons-learned.md` (LL-0007, written in the prior session)
stated: "the proto defines a `retention_policy` on `TopicInfo` that would
answer this via a `GetTopic` call." **This was wrong.** Re-reading
`src/salesforce/proto/pubsub_api.proto` directly shows `TopicInfo` has
only six fields: `topic_name`, `tenant_guid`, `can_publish`,
`can_subscribe`, `schema_id`, `rpc_id` - no retention field exists
anywhere in this proto. Calling the live `GetTopic` RPC
(`scripts/get-topic-info.ts`) confirmed the live API returns exactly
those six fields and nothing else, matching the proto exactly.

#### Impact

A documented "fact" in the DevEx journal was wrong for one review cycle.
Low impact here since it was caught before anything was built on the
assumption, but it's a direct example of why this project insists on
verifying against the live system (see LL-0002) - including verifying
claims already written down in its own prior documentation, not just
claims about the target platform.

#### Possible Enablement

None needed as a build item. Process note: when a prior DevEx entry makes
a specific technical claim, re-verify it before relying on it for new
work, the same as any other assumption. `docs/devex/lessons-learned.md`
LL-0007 has been corrected in place rather than left wrong.

---

### FL-0014: `ReplayPreset.CUSTOM` resumes strictly *after* the checkpointed replay ID — confirmed, not assumed

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Running the replay-checkpoint recovery experiment (`docs/devex/observations.md`
OB-0008): checkpointed the replay ID of a successfully-processed event
("Event A"), stopped the subscriber, published a second event ("Event B")
while offline, then restarted with `ReplayPreset.CUSTOM` from the
persisted checkpoint.

#### Friction

Not friction - a confirmation. The proto's comment on `FetchRequest`
already stated CUSTOM replay starts "after" the given `replay_id`, but
this was unverified in this project until now. The restart delivered
**only** Event B - Event A (whose replay ID was the checkpoint value
itself) was **not** redelivered. Confirmed via
`scripts/verify-recent-incidents.ts`: exactly one ServiceNow Incident per
correlation ID, no duplicates, in this specific run.

#### Impact

Positive: this is the behavior needed for the checkpoint mechanism to be
useful at all. But it only confirms the clean-shutdown case - the
checkpoint was written and the process exited normally *before* the
outage window began. It does **not** confirm what happens if the process
crashes in the narrower window between an event being successfully
processed (ServiceNow Incident created) and its checkpoint being
persisted to disk (`src/salesforce/checkpoint.ts`'s `saveCheckpoint`
runs *after* `onEvent` resolves - see `src/salesforce/pubsubClient.ts`).
In that gap, restarting would still hold the *previous* (stale)
checkpoint, and Salesforce would very plausibly redeliver the
already-processed event, causing exactly the kind of ServiceNow-side
duplicate `docs/devex/lessons-learned.md` LL-0005 found by a different
route (double-publishing). This gap was not tested and remains open.

#### Possible Enablement

Not decided yet. See `docs/devex/lessons-learned.md` LL-0008 for the
recommended next experiment targeting this specific gap.

---

### FL-0015: Confirmed — a crash between ServiceNow success and checkpoint persistence causes a real duplicate Incident

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Directly tested FL-0014/LL-0008's open question with a deterministic
experiment (`docs/devex/observations.md` OB-0009): added a single
env-var-gated crash point in `src/salesforce/pubsubClient.ts`, right
after `onEvent` succeeds (ServiceNow Incident created) and before
`saveCheckpoint()` runs. Published an event, let it process and hit the
forced exit, restarted from the now-stale checkpoint, and watched what
happened.

#### Friction

Confirmed, not inferred: Salesforce redelivered the exact same event
(same `eventId`/`correlationId`) after restart, the integration service
processed it again with no awareness it had already succeeded, and
ServiceNow ended up with **two separate Incidents**
(`INC0010007`, `INC0010008`) for one business event. Verified
independently at every boundary (checkpoint file contents, subscriber
logs, and a direct `verify-recent-incidents.ts` query against ServiceNow
- not just trusting the service's own console output).

#### Impact

This was previously an inference from reading the code (LL-0008); it is
now a directly observed, reproducible failure. It confirms the
replay-checkpoint mechanism added in the prior experiment (OB-0008),
while genuinely useful for crash recovery, does **not** prevent
ServiceNow-side duplicates on its own - and in fact makes the specific
timing of *when* the checkpoint is written a first-class design
decision, not an afterthought.

#### Possible Enablement

Not decided yet, and deliberately not fixed as part of this experiment
(no idempotency, dedup, or retry logic was added). See
`docs/devex/lessons-learned.md` LL-0008 (resolved) and its recommended
next experiment: testing the *other* checkpoint-ordering semantic
(write before calling ServiceNow, not after) to see what different
failure mode that trades this one for.

---

### FL-0016: Confirmed — checkpoint-before-ServiceNow causes silent event loss, not redelivery

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Directly tested the opposite of FL-0014/FL-0015's checkpoint ordering
(`docs/devex/observations.md` OB-0010): temporarily reversed
`pubsubClient.ts` to persist the replay checkpoint *before* calling
ServiceNow, added a second deterministic crash point right after that
checkpoint write, and observed what happens on restart.

#### Friction

Confirmed, not inferred: with the checkpoint persisted first, forcing a
crash before ServiceNow was ever called meant that on restart,
`ReplayPreset.CUSTOM` correctly resumed *after* the checkpointed replay
ID — so the event was never redelivered. Nothing else in the system ever
calls ServiceNow for it. Independently confirmed via
`verify-recent-incidents.ts`, both immediately after the crash and again
after the restart with no redelivery: zero Incidents ever existed for
that event's correlation ID. The business operation (distributor
onboarding) never happened, and nothing in this system detects that.

A related, unplanned finding: because the crash happens *before*
`onEvent` runs, there is no log line anywhere containing the event's
`correlationId` or any other business-identifiable field for this code
path - only an opaque base64 replay ID. In a real (non-experimental)
occurrence of this failure mode, there would be effectively no trace to
search for or alert on.

#### Impact

This is the mirror image of FL-0015, and arguably worse in a concrete
way: FL-0015's duplicate was visible (two ServiceNow Incidents exist,
just both need to be reconciled) and self-evidently wrong. This failure
mode leaves no ServiceNow record and no readily-searchable log trail —
the event is simply gone unless someone independently notices the
missing business outcome.

#### Possible Enablement

Not decided, and deliberately not fixed (no idempotency, dedup, retry,
or `ManagedSubscribe` was added or investigated). See
`docs/devex/lessons-learned.md` LL-0009 for the direct comparison of both
orderings and the recommended next investigation.

---

### FL-0017: Silent losses ARE detectable after the fact — but the current checkpoint mechanism retains no history to anchor a targeted search

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Investigating LL-0009's recommended question: can this system detect,
after the fact, that a replay checkpoint skipped an event that was never
acted on? Built a read-only diagnostic (`replayRange` in
`pubsubClient.ts`, `scripts/detect-unprocessed-events.ts`) rather than
assuming an answer either way.

#### Friction

Two distinct findings, one encouraging and one limiting:

1. **Detection works.** Replaying from a known-old position (Event D's
   checkpoint, on record from the prior experiment) with
   `ReplayPreset.CUSTOM` retrieved Event E's full data, including its
   `correlationId` - and cross-referencing that against ServiceNow
   correctly flagged it as a gap (no matching Incident), matching the
   independently-confirmed silent loss exactly.
2. **But the running system can't do this on its own.** `checkpoint.ts`
   uses `writeFileSync` to fully overwrite `.checkpoint.json` on every
   save - there is no history. The value on disk right now is Event E's
   own (post-loss) position; Event D's position, needed to anchor the
   search above, only existed because it happened to be recorded in this
   project's own conversation history, not because the codebase retained
   it anywhere.
3. **A history-free fallback exists and was confirmed viable:**
   `ReplayPreset.EARLIEST` returned all 11 events ever published to this
   topic across this entire project's testing - not just a recent
   window. A full reconciliation sweep from `EARLIEST`, cross-referenced
   against ServiceNow, correctly classified every one of those 11 events
   (see `docs/devex/observations.md` OB-0011 for the full list),
   including a genuine gap unrelated to LL-0009's specific bug: an event
   published before the ServiceNow adapter existed at all (predating
   `incidentAdapter.ts`), which has no Incident for an entirely different
   and unsurprising reason. No false positives or negatives found when
   cross-checked against known history.

#### Impact

Detection is real and practical today, via a manual/on-demand
investigation, not an automated safeguard. Without either retained
checkpoint history or a periodic `EARLIEST` sweep, a silent loss in
production would still go unnoticed indefinitely - the capability to
find it exists, but nothing currently triggers it.

#### Possible Enablement

Not decided, and deliberately not built as an automated mechanism. See
`docs/devex/lessons-learned.md` LL-0010 for the finding and the
recommended next step.

---

### FL-0018: ServiceNow's admin UI resists creating a genuine unique index, even with human-authenticated admin access

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

The spike's own recommended next step (OB-0013) was to have someone with
real ServiceNow admin access check what uniqueness mechanisms are
actually configurable, rather than reasoning from docs or from the
`itil` integration user's blocked access. Did exactly that, via a
human-authenticated admin browser session — deliberately not by
expanding the `itil` OAuth credentials' privileges (see OB-0015).

#### Friction

Confirmed `sys_dictionary` has no native "Unique" checkbox on either
`task.correlation_id` or `task.number` in this instance (exhaustively
checked, including the Dictionary Entry form's "Advanced view") — so the
real mechanism is `sys_index` (column-level uniqueness, `unique_index`
boolean, `access_method`, e.g. `btree`). Getting an actual unique index
persisted from there took three attempts, in order:

1. **Direct `sys_index.do` record creation (admin UI's raw new-record
   form):** the `Table` and `Access Method` fields set correctly and
   verifiably via the platform's own `g_form` client API (confirmed
   in-DOM, not just assumed), but submitting via the classic
   `sys_action=sysverb_insert` form-post mechanism returned a
   server-side `Error Message: Invalid insert`. No footer Save/Submit
   button existed on this page at all — the only way to submit it was
   via the classic hidden-field mechanism.
2. **The purpose-built "Database Indexes" wizard**, reached from the
   Incident table's own `sys_db_object` record (a distinct,
   `v_index_creator`-backed related list — not the raw `sys_index` list
   view). Here the "Unique Index" checkbox *was* genuinely editable
   (confirmed via `disabled`/`readOnly` both `false`, unlike the raw
   form) once a column was added via the slushbucket field picker. The
   custom field `u_gv_business_operation_id` (created for this
   investigation — see the architecture spike doc for its exact
   configuration) was selected, "Unique Index" was checked, and "Create
   Index" was submitted three separate ways (real UI click, and the
   underlying `indexConfirm('incident')` handler invoked directly) — all
   three produced a `200` response from ServiceNow's `xmlhttp.do`
   endpoint with no error surfaced to the caller, yet a subsequent,
   verifiably-working filtered query
   (`sys_index_list.do?sysparm_query=logical_table_name=incident`,
   confirmed to correctly return zero rows both before and after every
   attempt) never showed a persisted index record.

#### Impact

This is a real, reproducible practical barrier, not a definitive "not
possible" — the wizard's client-side code accepted the configuration and
the server acknowledged the request, but no index resulted, and no
in-page error explained why. Whether this is a deliberate platform
safeguard (e.g. requiring a background schema job, a licensing gate, or
a piece of interactive confirmation this automated session could not
safely trigger — see below) or an instance-specific quirk is unresolved.
Either way, "ServiceNow lets an admin add a unique index" is **not** the
same claim as "an admin can reliably do so through the standard UI in
under a few well-formed attempts" — that gap is itself evidence relevant
to how attractive target-side idempotency is as an operational choice,
independent of whether it's theoretically achievable.

One methodological note worth keeping: this session avoided ever
clicking through a native browser `confirm()`/`alert()` dialog (a hard
tooling-safety constraint), instead stubbing `window.confirm`/`alert` to
observe whether the index-creation handler used one. It never did in any
of the three attempts — so the silent no-result outcome was not simply
an un-clicked confirmation dialog.

#### Possible Enablement

Not decided. If target-side idempotency is pursued further, the next
step would be a ServiceNow-side investigation with actual platform
support access (or ServiceNow's own support channel) to determine why
index creation silently no-ops in this instance — not something to keep
guessing at through the UI. See
`docs/architecture/0001-reliability-architecture-spike.md` for how this
folds into the candidate comparison.

#### Follow-up 2026-09-15: two real causes found and fixed; the index still does not persist

Resumed this investigation specifically to resolve the mystery above.
Found and eliminated two genuine causes — but the underlying question is
still not answered.

**Cause 1 (found and fixed): `security_admin` was assigned but not
elevated for the session.** `g_user.hasRole('security_admin')` returned
`true` throughout, which is misleading — ServiceNow separates *having*
a role from that role being *active* in a session for roles flagged as
elevated-privilege. The admin user's own avatar menu exposed an
"Elevate role" action; checking `security_admin` there and confirming it
changed the avatar's own `aria-label` from `"System Administrator:
Available"` to `"System Administrator: security_admin, Available"` —
independently confirming elevation was genuinely active, not just
attempted. **This was a real, necessary step**, not a false lead: before
elevation, submitting the index-creation wizard produced a silent `200`
response with no feedback (the original observation above). After
elevation, submitting the *exact same* wizard against the *exact same*
field produced a real, specific, actionable browser `alert()`:
*"Requested fields (u_gv_business_operation_id) contain duplicate
values. Please remove the duplicate values and then try again."*
Elevation didn't just add access — it changed what ServiceNow was
willing to tell this session about why an operation failed.

**Cause 2 (found and fixed): that alert was correct.** OB-0014's own
concurrency experiment had left exactly one duplicate pair in place —
`INC0010009` and `INC0010010` both carry
`u_gv_business_operation_id = 8a323db6-c582-4f2f-b54a-f25320bd1e3a`,
which is precisely what a real unique-index build would refuse to index.
Cleared the field on `INC0010009` (not deleted — the record itself is
untouched) via the standard Incident form, verified independently via a
fresh list query that only one record now carries a value for that
field, confirming ServiceNow's stated blocking reason was accurate, not
a red herring.

**Retried with both causes fixed — still no persisted index.** Elevated
session, no duplicate values, same wizard, same field, "Unique Index"
checked: this time the submission returned `200`/`200` with **no**
alert and **no** `confirm()` call (both were stubbed and observed, per
this project's standing rule against triggering native browser dialogs
via automation — neither fired). The second response's payload
contained embedded UI message-catalog text reading (in part) *"Index
creation successfully scheduled... ServiceNow will generate your index
for you in the background... Upon completion of the index generation,
the system will send you a confirmation email."* That text is
**inconclusive on its own** — it's a client-side i18n message
definition bundled with the response, not proof the message was
actually shown or that a job was actually queued. Checked for
independent, harder evidence instead, after waiting 30 seconds:

- `sys_index_list.do` filtered on `logical_table_name=incident`: still
  zero rows (same query already confirmed to filter correctly, not
  silently ignored).
- `staged_alter_history` (the table ServiceNow itself uses to track
  in-progress schema alterations): **zero records — for any table,
  ever**, in this instance. Not just no record for our attempt; the
  table has never recorded a single staged alter.
- `sys_email_list.do`: no email resembling an index-completion
  notification; the most recent entry predates this round's attempts.
- `sys_index_suggestion` (a *different*, automatic slow-query-driven
  advisor feature discovered while searching for alternative
  index-tracking tables): also empty, and unrelated to a manually
  requested index — a dead end, not the missing mechanism.
- `sys_dictionary` for `u_gv_business_operation_id` still exposes no
  `unique`/`is_unique`/`db_unique`-named field of any kind, consistent
  with the very first finding in this entry.

Three independent tables and a direct re-check of the field's own
dictionary entry all agree: no unique constraint exists. The
"successfully scheduled" wording appears to be dead UI copy for a
job-queuing path this instance's `indexConfirm()` handler does not
actually reach, or reaches without effect — which specific case is true
remains unknown.

**Where this leaves the investigation:** the two most likely blockers a
reasonable person would guess at (privilege elevation, dirty data) have
both been directly tested, found real, and fixed — and the index still
doesn't persist. That rules out the two most likely explanations without
resolving the mystery. Per this round's explicit instruction, no further
workaround (application-level locking, lookup-before-create, or any
other idempotency mechanism) was attempted as a substitute. See
`docs/architecture/0001-reliability-architecture-spike.md` §3a for how
this changes the candidate comparison. The core answer is unchanged from
the original entry: the target-side uniqueness mechanism could not be
verified as active, so the concurrency experiment was not rerun under a
claimed "enforced" premise — see OB-0016.

---

### FL-0019: `node:sqlite` has no type coverage in this project's pinned `@types/node`

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

#### Observation

Building the durable-state idempotency prototype (`scripts/lib/idempotencyStore.ts`,
OB-0017/OB-0018), chose `node:sqlite` deliberately - it ships with
Node 22 (confirmed available, if experimental, on this project's
Node 22.18.0), giving a real atomic `PRIMARY KEY` constraint with zero
new npm dependency, which fits this project's minimalism better than
adding a SQLite driver package for an investigation-only script.

#### Friction

TypeScript has no idea `node:sqlite` exists. This project's
`@types/node` is pinned to `^20.14.10` (a version that predates the
module), so `import { DatabaseSync } from 'node:sqlite'` fails to
type-check with no ambient types available.

#### Impact

Minor, but real: had to hand-write a small local interface
(`SqliteStatement`/`SqliteDatabase`) covering only the handful of
methods actually used, and load the module via `require(...)` cast to
that shape instead of a normal typed `import`. Correct and fully typed
where it matters, but is a slightly unusual pattern compared to the
rest of this codebase's imports, and would need to be
revisited/simplified if `node:sqlite` is ever used somewhere less
disposable than an investigation script.

#### Possible Enablement

If durable state ends up chosen as the real architecture (not yet
decided - see the architecture spike), bump `@types/node` to a version
that covers `node:sqlite` at that point, rather than now for a
throwaway prototype. Not done here - out of scope for an investigation
script per this round's instructions.

#### Follow-up 2026-09-16: root cause of the raw-form path identified with certainty; the wizard's failure narrowed further, not yet explained

Resumed this investigation with one bounded goal: stop guessing at causes
and either configure a real target-side uniqueness constraint or obtain
the strongest available evidence for why not - without building any
workaround (no business rules, no Candidate C reclaim logic) merely to
make this candidate succeed.

**Definitively identified why the raw `sys_index.do` form has failed
every time (the "Invalid insert" error from the original entry above).**
Read the `sys_index` table's own `create` Access Control directly
(`sys_security_acl.do?sys_id=4c61b5036f070200c8126852be3ee4c0`):
`admin_overrides` is `false`, and its one required role
(`sys_security_acl_role`) is **`nobody`** - ServiceNow's standard,
documented convention for a role that cannot be assigned to any user.
Combined with `admin_overrides=false` (meaning even the `admin` role's
usual automatic bypass does not apply to this specific ACL), this is a
**deliberate, universal, by-design platform restriction**, authored by
`system` in 2015 (original OOB platform configuration, not something
particular to this instance's customization) - not a permissions gap,
not bad procedure, not something any amount of privilege elevation
could ever satisfy. This fully explains every "Invalid insert" seen
against the raw form, in this round and the original one.

**The "Database Indexes" wizard - ServiceNow's own supported path,
presumably built specifically to work around the restriction above -
was retested three ways this round, all with `security_admin`
re-verified active for this session (a fresh browser session; elevation
does not persist across sessions and had to be redone, confirmed again
via the avatar `aria-label`):**

1. Against `incident.u_gv_business_operation_id` with **no** unique
   flag set (a plain, non-unique index) - to isolate whether the
   *uniqueness* flag specifically was the problem. It was not: the
   plain index also returned `200`/no error and also did not persist.
2. Against the same field with the unique flag set again, on a table
   confirmed to now have zero duplicate values (this session's own
   earlier duplicate, from OB-0014, was never re-introduced) - same
   non-persisting outcome.
3. **Against a brand-new, empty, single-field custom table**
   (`u_gv_index_test`, one `String` column, zero rows, created live for
   this test) with the unique flag set - to isolate whether `incident`'s
   size, `task` inheritance, or field type was the cause. Same outcome:
   `200`/`200`, no `confirm()`, no `alert()`, no error - and zero
   persisted `sys_index` record for this table, confirmed via the same
   verified-working filtered query used throughout this investigation.

**Net result: privilege, dirty data, table complexity, and field type
are now all ruled out as explanations for the wizard's failure**, not
merely unconsidered. What remains genuinely unknown is whether this
PDI's specific edition/plugin configuration restricts the underlying
schema-alteration mechanism the wizard depends on (plausible - shared
developer instances commonly restrict DDL for platform stability), or
something else not observable from this browser session.

**One methodological correction, unrelated to the finding above but
worth recording:** while creating the test field for scenario 3, a
`g_form.setValue()` call for a reference-typed field (`internal_type`
on a Dictionary Entry) silently failed to resolve ("Match not found,
reset to original"), producing a separate, misleading "Invalid insert"
on that unrelated form. Real UI clicks/typeahead selection fixed it
immediately. This did **not** affect any of this investigation's actual
`sys_index` findings (the wizard flow never sets a reference field via
JS - it only ever uses the already-proven `moveOption` slushbucket and
a checkbox), but it's a reminder that `g_form.setValue()` on a
reference field can silently no-op without an error at set time, only
surfacing on submit - worth remembering before trusting any future
"confirmed in-DOM" claim for a reference field set this way.

**Not attempted this round, deliberately:** Import Set + Transform Map
coalesce, the other named "supported mechanism" candidate from the
original spike. Reasoned about instead of hands-on tested, to keep this
round bounded: ServiceNow's documented Transform Map coalesce behavior
is implemented via an internal query-then-write pattern against the
target table, not a documented raw database-level atomic upsert
primitive - meaning its concurrency guarantee, if any, would likely be
equivalent in kind to lookup-before-create (Candidate B) unless the
coalesce field is *also* backed by a genuine unique index - which loops
back to the same unresolved mechanism this entire entry is about. This
reasoning has not been empirically verified and is flagged as such, not
presented as established fact.

No ADR-adjacent workaround was built. No enforceable constraint was
achieved, so the concurrency experiment was not rerun a third time under
a claimed "enforced" premise - see OB-0019 and the architecture spike
document for the full comparison against Candidate C.

---

### FL-0020: Testing staleness-based reclaim honestly requires real elapsed time, not a mocked clock

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience

#### Observation

Building `reclaim()`'s test (`scripts/test-durable-state-reclaim-ambiguity.ts`,
OB-0020) required making a record genuinely stale - old enough that
`acquired_at < cutoff` would be true - to test the reclaim path for
real, not by construction.

#### Friction

The straightforward options were both worth naming rather than picking
silently: (a) mock/fake the system clock so `acquired_at` and the
reclaim check disagree without any real delay, or (b) actually wait.
Mocking risks quietly testing the mock instead of the real staleness
check (a wrong clock-mocking setup can make a broken comparison look
correct, or vice versa) - a real concern for a project whose whole
premise is not trusting assumptions. Chose (b): a real 2.5-second
`sleep()` against a 2-second staleness threshold, so the elapsed time
in the test is the same kind of elapsed time a real crash-then-retry
would produce.

#### Impact

Small and one-time here (adds ~2.5 seconds to one script's run), but
worth recording as a real tradeoff: a future reclaim mechanism with a
realistic staleness window (minutes, not seconds) would make this
honest-clock approach impractical for fast test iteration, and would
need either a real clock abstraction (dependency-injected "now," not a
global mock) or accept slow tests - a decision this prototype didn't
have to make yet because its window was small.

#### Possible Enablement

Not decided, and not needed yet - this project's staleness windows so
far are test-only, seconds-scale values, not production tuning. If a
real reclaim policy is ever built, its own tests will need to decide
this deliberately rather than default to whatever happened to work
here.

---

### FL-0021: Proving a race is genuine requires genuinely separate processes - and that costs real coordination overhead

**Date:** 2026-09-16
**Phase:** Phase 1 — Developer Experience

#### Observation

Every prior durable-state experiment (OB-0017, OB-0018, OB-0020,
OB-0021) ran entirely inside one Node process, using `Promise.all` or
sequential `await` calls to simulate concurrency. That was good enough
for those questions, but FL-0018's own standing lesson (don't trust
reasoning where a real test is possible) applied here too: the
slow-owner race specifically depends on one worker being genuinely
still alive and executing while another acts - something one
single-threaded process cannot honestly produce, only simulate.

#### Friction

Building `scripts/test-durable-state-slow-worker-race.ts` meant
spawning two real OS processes (`child_process.spawn('npx', ['ts-node', ...])`)
instead of calling two functions. That introduced coordination concerns
none of the earlier scripts had: each `ts-node` cold start carries real
startup overhead (roughly 1-2 seconds before a spawned worker's own
code even begins running), so the deliberate timing margins
(Worker A's delay vs. Worker B's wait-before-reclaim) had to be sized
generously enough to absorb that overhead reliably, not just cover the
logical delay being tested. Getting `cwd` right for each spawned
process also mattered in a way it hadn't before - `dotenv/config`
(loaded by `src/config.ts`) resolves `.env` relative to
`process.cwd()`, so a spawned child needed its `cwd` explicitly set to
the service root or it would silently fail to find ServiceNow
credentials.

#### Impact

Small and one-time - the experiment worked on the first real run once
these were accounted for - but real: an experiment like this takes
noticeably longer to write correctly and run (each iteration is
several seconds of deliberate, real wall-clock delay plus process
spawn overhead, not milliseconds) than the single-process alternative
it replaced.

#### Possible Enablement

Not decided, and not needed yet - this project has only needed this
pattern once so far. If genuinely-concurrent-process testing becomes a
recurring need, a small shared spawn-and-collect helper (parsing
`WORKER_*:` marker lines from stdout, as this script does inline) would
be worth extracting - premature to build from a single use.

---

### FL-0022: `checkpoint.ts`'s single-instance assumption blocks testing genuine multi-process concurrency at the real entry point

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)

#### Observation

Wiring the durable-ownership gate into `src/index.ts` (ADR 0005's Tier 1)
raised a testing question the architecture investigation's own scripts
never had to answer: how do you exercise the *real* concurrent-initial-
processing scenario - two independent subscriber instances racing to
process the same broadcast Platform Event - through the actual
production entry point, not a stand-in for it?

#### Friction

Running two real `npm run dev` processes side by side would be the
literal answer, and Salesforce Pub/Sub delivery genuinely supports it
(each independent `Subscribe()` stream receives its own copy of a
published event - this is not competing-consumer/queue semantics). But
`src/salesforce/checkpoint.ts` was never designed with more than one
instance in mind: it reads and writes a single, shared
`.checkpoint.json` file with no coordination between writers. Two
instances started against the same checkpoint state would each save
their own view of "the last processed position" to the same file,
racing each other in a way that has nothing to do with the idempotency
gate this round was actually trying to test - it would confound the
result, not clarify it.

#### Impact

Chose not to test that way this round - instead, exercised the real
`processDistributorOnboardingEvent()` function (the same function
`src/index.ts` calls for every event) directly and concurrently from a
script (`scripts/test-production-concurrent-idempotency.ts`),
simulating two independent deliveries without needing two live
subscriptions. This is a faithful test of the durable-ownership gate
specifically, but it is not literally "two running copies of the
service" - a gap between what was tested and what a future genuine
multi-instance deployment would need to survive.

#### Possible Enablement

Not decided, and not needed for Tier 1 as currently scoped (this
project runs one subscriber instance). If this integration - or any
Golden Path integration built the same way - is ever expected to run
more than one instance concurrently (horizontal scaling, or even just a
brief overlap during a rolling redeploy), `checkpoint.ts`'s single-file,
uncoordinated design would need to be revisited before that becomes
safe. Not proposed as a specific fix here - just named as a real,
previously-invisible limitation this round's testing needs surfaced.

---

### FL-0023: What should happen to the checkpoint when a delivery is correctly rejected, not processed?

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)

#### Observation

ADR 0005's processing diagram shows both branches - `acquired` and
`already owned/completed` - converging on a single "checkpoint as
appropriate" step, but doesn't spell out the mechanics: should
`src/salesforce/pubsubClient.ts` still advance the Salesforce replay
checkpoint for a delivery the durable-ownership gate correctly decided
*not* to act on?

#### Friction

Getting this wrong in either direction has a real, different cost.
Checkpoint forward regardless of the gate's decision, and a delivery
that arrives *while its own earlier attempt is still `in_flight`*
(e.g. a crash between `acquireOperation` and `completeOperation`, with
no reclaim mechanism wired in yet - deliberately out of scope for this
round) gets checkpointed past without ever completing - the business
operation is silently stuck until a human intervenes, the same shape of
loss as OB-0018, just narrowed to a smaller window (the gap between
acquire and completion, not the whole processing step). Don't
checkpoint forward, and *every* correctly-rejected duplicate delivery
would leave the replay position stuck at that point forever, since
nothing else ever advances it - Salesforce would redeliver the same
already-decided event indefinitely, blocking all subsequent processing,
not just the one business operation.

#### Impact

Resolved by not changing `pubsubClient.ts` at all: both branches in
`processDistributorOnboardingEvent()` return normally without throwing,
so the existing "checkpoint after `onEvent` resolves" behavior already
does the right thing - advances past a correctly-rejected duplicate
(no infinite redelivery loop), and only fails to advance past a
delivery whose processing itself throws (unchanged from before this
round). The narrower stuck-operation risk described above is a known,
deliberate, already-documented consequence of deferring reclaim to a
later Enablement step (see ADR 0005), not a new architectural gap this
round introduced - but it was worth deriving explicitly rather than
assuming the existing checkpoint behavior would "just work" without
checking it against the new gate.

#### Possible Enablement

None yet - this is exactly the gap reclaim (the next Tier 1 Enablement
step) exists to close. Recorded here so the reasoning doesn't need to
be re-derived when that step is picked up.

---

### FL-0024: Recovery needs the original event payload, but the durable store deliberately doesn't keep one

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)

#### Observation

Writing `recoverStaleDistributorOnboardingOperation()`: the "absent"
branch of ADR 0005's recovery diagram has to call
`createOnboardingIncident()`, which needs the full event - distributor
name, contact, sales owner, opportunity, account - not just a
business-operation ID.

#### Friction

`business_operations` (the table `src/reliability/idempotencyStore.ts`
owns) stores only the ID, status, and timestamps - by design, per
OB-0025/this file's own idempotencyStore.ts header comment, to keep
that module ignorant of any target's data shape. But that means a stale
`in_flight` row, on its own, carries no information sufficient to
recreate the Incident it was supposed to produce. The recovery function
can't be "just give it the ID and it figures out the rest" - it has to
be handed the event again from somewhere.

#### Impact

Not a blocker, but a real design constraint that wasn't obvious until
implementation forced it: recovery is not self-contained the way
`processDistributorOnboardingEvent()` is. It depends on a second,
already-existing durable source for the event payload - Salesforce
itself, via the replay capability this project already validated
(`pubsubClient.ts`'s `replayRange()`, OB-0011) - rather than needing
`idempotencyStore.ts` to duplicate that storage locally. This round's
test script (`scripts/test-production-recovery.ts`) sidesteps the
question by constructing the event directly, since no replay-driven
caller exists yet; a real recovery worker will need to actually perform
that replay to get the event before it can call this function.

#### Possible Enablement

None yet. Worth remembering when the next Enablement step (a
recovery-triggering worker) is scoped: it needs to pair a `GAP`/stale
finding with an actual replay of the corresponding Salesforce event,
not just the correlationId, before it can call
`recoverStaleDistributorOnboardingOperation()`.

---

### FL-0025: A stale in-flight operation is invisible to normal redelivery - recovery only happens if something deliberately calls it

**Date:** 2026-09-16
**Phase:** Phase 1 — Enablement (ADR 0005, Tier 1)

#### Observation

Given FL-0023's resolution (both branches of
`processDistributorOnboardingEvent()` checkpoint forward normally): what
happens when Salesforce naturally redelivers an event whose business
operation is genuinely stuck `in_flight` from an earlier crash?

#### Friction

`acquireOperation()` sees the existing row, returns `false`, and
`processDistributorOnboardingEvent()` takes its "already owned - not
creating another Incident" branch, logs it, and returns normally -
exactly the same as if the operation had completed successfully. A
naturally-redelivered event for a genuinely stuck operation is
therefore silently and permanently absorbed by the normal path; it
never reaches `reclaimOperation()`, because nothing on the normal path
calls it. Recovery only happens for an operation that something
external deliberately decides to recover - normal event traffic,
including Salesforce's own redelivery of the exact event that could
supply everything recovery needs (see FL-0024), does not trigger it.

#### Impact

This sharpens, rather than closes, the risk FL-0023 already named as
deliberate and known: a stuck operation stays stuck not just until
reclaim exists as a mechanism (true as of last round), but until
something - today, nothing - actually invokes it for that specific
operation. The audit tool (`detect-unprocessed-events.ts`) can already
identify these as `GAP`, but classifying a gap and recovering it are
still two disconnected steps; closing that gap is exactly the
"automatic (rather than on-demand) detection trigger" already named as
not-yet-built in `CLAUDE.md`, now sharpened into "and something has to
actually call recovery when it fires."

#### Possible Enablement

None yet - explicitly out of scope for this round (no scheduled/
automatic recovery). Recorded so the next Enablement step doesn't have
to rediscover that classifying a gap and recovering it are separate
concerns.

---

<!-- Add new entries above this line, most recent first. -->
