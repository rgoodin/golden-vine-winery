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

<!-- Add new entries above this line, most recent first. -->
