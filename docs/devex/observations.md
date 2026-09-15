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

<!-- Add new entries above this line, most recent first. -->
