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

<!-- Add new entries above this line, most recent first. -->
