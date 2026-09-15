# DevEx Decisions

This is a lightweight log of in-the-moment decisions made while working
through the developer experience of building the integration — the small
calls a developer makes day to day (which tool to use, how to name
something, which shortcut to take and why).

This is **not** the place for formal architectural decisions. Significant,
durable architectural decisions belong in `docs/decisions/` as Architecture
Decision Records (Context / Decision / Alternatives considered /
Consequences), per `CLAUDE.md`. Use this log for smaller, working-level
decisions that don't rise to that level but are still worth remembering —
and that may later reveal a pattern worth promoting to an ADR.

See also `docs/devex/observations.md`, `docs/devex/friction-log.md`, and
`docs/devex/lessons-learned.md`.

## How to use this log

1. When you make a small decision worth remembering, log it here rather than
   letting it live only in commit history or memory.
2. If a decision turns out to be architecturally significant, promote it to
   an ADR in `docs/decisions/` and link back to the entry here.

---

## Template

### DEC-XXXX: <short title>

**Date:** YYYY-MM-DD
**Phase:** <current DevEx Dojo phase>

**Decision:** What was decided?

**Context:** Why did this decision come up?

**Alternatives considered:** What else was possible?

**Reasoning:** Why this option, at this time?

---

### DEC-0001: Integration service language/runtime — Node.js + TypeScript

**Date:** 2026-09-15
**Phase:** Phase 1 — Developer Experience

**Decision:** Build the integration service in Node.js + TypeScript.

**Context:** Scaffolding the first Salesforce → ServiceNow integration
service required picking a language/runtime; none had been chosen yet.

**Alternatives considered:** Python, Java.

**Reasoning:** Developer preference. Straightforward async event handling
and a wide range of HTTP/gRPC client libraries for the Salesforce subscriber
and the ServiceNow adapter to come.

---

<!-- Add new entries above this line, most recent first. -->
