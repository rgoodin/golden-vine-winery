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

<!-- Add new entries above this line, most recent first. -->
