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

<!-- Add new entries above this line, most recent first. -->
