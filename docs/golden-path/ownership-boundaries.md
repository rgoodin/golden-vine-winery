# Golden Path Ownership Boundaries

**Status:** Current checkpoint, not a permanent org chart. One of the
Dojo's explicit purposes is discovering when a row in this table should
move — see `docs/devex/phase-2-observation-review.md` (this table
summarizes conclusions reached there; it does not introduce new ones)
and `docs/golden-path/0002-design-principles.md`'s "Abstractions are
earned through repetition." Revisit this table when a second target or
a second integration produces real evidence that a boundary is drawn in
the wrong place — not preemptively.

This is deliberately a short table, not a RACI matrix. Add rows only
when a real ownership question has actually come up.

| Concern | Current ownership | Why |
|---|---|---|
| Business intent / customer requirement | Business + Development | Only the business knows what the integration is actually for. |
| Definition of business operation / duplicate | Business + Development | Platform cannot decide what two events mean without knowing the business intent behind them (Finding 8). |
| Canonical event contract | Platform initially, with heavy Business/Development input | Started centrally coordinated for one integration; not assumed permanent (Finding 6). |
| Supported integration mechanism (e.g. Pub/Sub API) | Platform | Avoids unnecessary proliferation of competing mechanisms for the same integration class (Finding 4). Developers can challenge with evidence. |
| Salesforce transport mechanics (gRPC, schema resolution, replay/checkpoint) | Platform | Accidental complexity a developer gains nothing from re-deriving (Finding 3). |
| Human identity/verification steps (e.g. Salesforce email verification) | Developer participates; Platform documents | Irreducible human step, not something to automate away (Finding 2). |
| ServiceNow machine identity / OAuth / roles / ACLs | Platform / ServiceNow team | Not developer self-service until real evidence justifies it (Finding 5). |
| Business field mapping (event → target record) | Business + Development | Encodes what the business record should actually contain. |
| Reliability mechanisms (durable ownership, reclaim, reconciliation) | Platform | Implementation of an agreed guarantee, not a business decision itself. |
| Reliability fitness for a customer's requirement | Development evaluates, with Business/Customer | The Golden Path provides evidence; the developer determines fit (Finding 9 — "not a gold watch"). |
| Recovery risk / policy (thresholds, cadence) | Business/Customer | Platform measures and implements; it does not decide when retry risk beats wait/miss risk (Finding 11). |
| Recovery implementation | Platform | The mechanism, once the policy is set. |
| Logging / alerting / evidence machinery | Platform / Operations | Supports every other row without deciding any of them. |
| Audit interpretation (`OK`/`GAP`/`DUPLICATE`/`UNEVALUABLE`) | Developer should understand | Part of validating their own integration (Finding 13). |
| Operational audit machinery (scheduling, locking, replay scanning) | Platform / Operations | Developers consume results; they don't maintain the machinery unless working on it (Finding 13). |
| Golden Path exception / challenge | Developer + Platform/Dojo | A developer can reject the path with evidence; that evidence should come back before silent abandonment (Finding 10). |
