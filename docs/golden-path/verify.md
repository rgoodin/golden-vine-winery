# Verify

Don't take this Golden Path's reliability behavior on faith. Run the
experiments that established it, against your own integration, and see
the properties for yourself - see Phase 2 Observation Review Finding 7:
"Golden Path reliability experiments should remain visible."

## The representative set

From `services/integration-service/scripts/`, in order:

1. **`test-production-concurrent-idempotency.ts`** - fires two
   concurrent deliveries of the same business-operation ID through the
   real processing function. Confirms exactly one creates a target
   record; the other is correctly rejected as already-owned.
2. **`test-production-recovery.ts`** - reproduces both crash boundaries
   (crash before the target call; crash after it succeeds but before
   local completion is recorded) and concurrent reclaim, all through the
   real recovery function against a live target. Confirms recovery
   closes both boundaries without creating a duplicate.
3. **The slow-owner race** (`scripts/lib/slowWorkerA.ts` +
   `slowWorkerB.ts`, run via
   `test-durable-state-slow-worker-race.ts`) - two genuinely independent
   OS processes, one still actually working while the other reclaims and
   recovers. **This one fails on purpose.** It demonstrates a real,
   still-open limitation (`docs/devex/observations.md` OB-0022): a
   slow-but-alive original owner can be reclaimed and produce a real
   duplicate. Run it to see the failure, not to confirm success - see
   why below.

This is a deliberately small, curated subset of a much larger
experimental history (`docs/golden-path/0001-enablement-inventory.md`
category D lists the rest) - these three were chosen because they run
against the actual production code path your integration uses, not a
throwaway prototype, and because together they cover the guarantee this
Golden Path actually makes and the one thing it explicitly doesn't.

## Why the slow-owner race belongs in Verify, not just in a findings doc

A Golden Path that only shows you the experiments that pass would be
overclaiming. This one is included specifically so "Verify" means what
it says - here is the evidence for what works *and* what doesn't, so
you can weigh the gap against your own requirement
(`docs/golden-path/evaluate.md`), not discover it in production.

## Operational evidence, separately

`npm run detect-unprocessed-events` (audit-only, read-only) classifies
every event's outcome against the target: `OK`, `GAP`, `DUPLICATE`,
`UNEVALUABLE`. This is not a one-time experiment - it's the ongoing
operational evidence this Golden Path produces continuously (currently
hourly, via cron - see
`services/integration-service/README.md`, "Operating the scheduled
audit"). You should be able to read and act on this output; you
shouldn't need to maintain the sweep/schedule/lock machinery behind it
unless you're specifically working on that capability (Finding 13).

Next: `docs/golden-path/evaluate.md`.
