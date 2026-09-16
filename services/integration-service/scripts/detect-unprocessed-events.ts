import { replayRange } from '../src/salesforce/pubsubClient';
import { config } from '../src/config';
import { authenticate } from '../src/servicenow/auth';
import { toCanonicalEvent } from '../src/salesforce/subscriber';
import { recoverStaleDistributorOnboardingOperation } from '../src/recoverStaleDistributorOnboardingOperation';

/**
 * Audit instrument (Phase 3 - not promoted to the Golden Path), extended
 * with an explicit, opt-in recovery mode (Enablement, ADR 0006). Still
 * one script, two clearly separated responsibilities:
 *
 * AUDIT (always runs, always read-only): replays Salesforce events and
 * counts matching ServiceNow Incidents per correlation ID, classifying
 * silent loss (LL-0009) and duplicate processing (LL-0005/LL-0008) after
 * the fact. Never touches the runtime checkpoint, never calls
 * ServiceNow's write API, never modifies subscriber/checkpoint/replay
 * behavior. See docs/devex/lessons-learned.md LL-0010/LL-0011.
 *
 * RECOVERY (opt-in only, via --recover=<staleAfterMs>): for each GAP
 * this same run just classified, hands the exact already-decoded
 * Salesforce event straight to the real production recovery function
 * (`recoverStaleDistributorOnboardingOperation`, OB-0026) - no second
 * Salesforce replay lookup, no reimplementation of reclaim or
 * reconciliation. This is composition of two already-validated
 * components (OB-0027, ADR 0006), not a new mechanism:
 *
 *   audit/source sweep         -> detects GAP, already holds the source event
 *   reliability/recovery orchestration -> owns reclaim/recovery (unchanged)
 *   ServiceNow reconciliation adapter  -> owns "does the target already have it" (unchanged)
 *
 * DUPLICATE and OK are never routed through recovery, in either mode -
 * recovery is GAP-only, by construction of the branch below, not a
 * runtime check that could be bypassed.
 *
 * Usage:
 *   npm run detect-unprocessed-events                              # audit only, full sweep
 *   npm run detect-unprocessed-events -- <fromReplayIdBase64>       # audit only, from a known-good position
 *   npm run detect-unprocessed-events -- --recover=<staleAfterMs>   # audit + recover GAPs, full sweep
 *   npm run detect-unprocessed-events -- --recover=<staleAfterMs> <fromReplayIdBase64>
 *
 * `--recover` requires an explicit millisecond value - this script has
 * no default staleness threshold to fall back on. ADR 0005 already
 * names that threshold an operational tuning knob this project has not
 * chosen a production value for (a function of reclaim policy vs. real
 * ServiceNow call latency); guessing one silently here would be
 * inventing that decision by accident rather than making it
 * deliberately.
 *
 * With no positional argument, sweeps everything Salesforce has
 * retained for this topic (confirmed viable - see
 * docs/devex/friction-log.md FL-0017). With one, that replay ID must be
 * a position you already know precedes the region of interest - this
 * script does not find that position on its own (FL-0017).
 *
 * Classification per event with a usable correlationId:
 *   0 matching Incidents  -> GAP        (recovery attempted only in --recover mode)
 *   1 matching Incident   -> OK         (never touched by recovery)
 *   >1 matching Incidents -> DUPLICATE  (reports Incident numbers as evidence; never touched by recovery)
 *
 * Events with no Correlation_Id__c (predating that field's existence -
 * see docs/decisions/0003-platform-event-schema.md) are reported as
 * UNEVALUABLE, a distinct category from GAP - the absence of a side
 * effect can't be established for something that predates the
 * mechanism used to look it up, and is never a recovery candidate.
 *
 * A GAP that recovery could not reclaim this run (no local durable
 * record, not yet stale under the given threshold, or already
 * completed locally despite ServiceNow showing nothing) is reported as
 * NOT RECOVERED and remains GAP - never silently treated as resolved,
 * per ADR 0006.
 */
interface IncidentMatch {
  number: string;
  sys_id: string;
}

async function findIncidentsForCorrelationId(correlationId: string): Promise<IncidentMatch[]> {
  const { accessToken } = await authenticate();
  const query = new URLSearchParams({
    sysparm_query: `correlation_id=${correlationId}`,
    sysparm_fields: 'number,sys_id',
    sysparm_limit: '50',
  });
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { result?: IncidentMatch[] };
  if (!response.ok) {
    throw new Error(`ServiceNow query failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.result ?? [];
}

type Classification = 'UNEVALUABLE' | 'GAP' | 'OK' | 'DUPLICATE';

interface ParsedArgs {
  from: string;
  recover: boolean;
  staleAfterMs: number | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  let recover = false;
  let staleAfterMs: number | null = null;
  let from: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--recover=')) {
      recover = true;
      staleAfterMs = Number(arg.slice('--recover='.length));
    } else if (arg === '--recover') {
      recover = true; // deliberately left without a threshold - rejected below, not defaulted
    } else if (!arg.startsWith('--')) {
      from = arg;
    }
  }

  return { from: from ?? 'EARLIEST', recover, staleAfterMs };
}

async function main() {
  const { from, recover, staleAfterMs } = parseArgs(process.argv.slice(2));

  if (recover && (staleAfterMs === null || Number.isNaN(staleAfterMs) || staleAfterMs <= 0)) {
    console.error(
      'Recovery mode requires an explicit staleness threshold: --recover=<milliseconds> (e.g. --recover=120000). ' +
        'Refusing to guess a default - see this file\'s header comment.'
    );
    process.exit(1);
    return;
  }

  console.log(
    recover
      ? `Mode: AUDIT + RECOVER GAPS (--recover=${staleAfterMs}ms). GAP classifications will attempt ` +
          'recovery and MAY create a ServiceNow Incident for any that are locally reclaimable. ' +
          'OK, DUPLICATE, and UNEVALUABLE remain read-only, exactly as in audit-only mode.'
      : 'Mode: AUDIT ONLY (read-only - no ServiceNow writes, no state changes). Pass ' +
          '--recover=<staleAfterMs> to also attempt recovery of GAP classifications.'
  );
  console.log(
    `Replaying events from ${from === 'EARLIEST' ? 'EARLIEST (full sweep)' : `replayId=${from}`}...`
  );
  const events = await replayRange(config.salesforce.pubsubTopic, from);
  console.log(`Collected ${events.length} event(s) from Salesforce.\n`);

  const tally: Record<Classification, number> = { UNEVALUABLE: 0, GAP: 0, OK: 0, DUPLICATE: 0 };
  let recoveredCount = 0;
  let notRecoveredCount = 0;

  for (const event of events) {
    const correlationId = event.payload.Correlation_Id__c as string | undefined;
    const distributorName = event.payload.Distributor_Name__c as string | undefined;
    const replayId = event.replayId.toString('base64');

    if (!correlationId) {
      tally.UNEVALUABLE++;
      console.log(
        `UNEVALUABLE  - no Correlation_Id__c (predates required schema) - ` +
          `replayId=${replayId} payload=${JSON.stringify(event.payload)}`
      );
      continue;
    }

    const incidents = await findIncidentsForCorrelationId(correlationId);
    const classification: Classification =
      incidents.length === 0 ? 'GAP' : incidents.length === 1 ? 'OK' : 'DUPLICATE';
    tally[classification]++;

    const evidence =
      incidents.length > 0
        ? ` incidents=[${incidents.map((i) => i.number).join(', ')}] count=${incidents.length}`
        : '';
    console.log(
      `${classification.padEnd(12)} - correlationId=${correlationId} ` +
        `distributor="${distributorName}" replayId=${replayId}${evidence}`
    );

    // Recovery is attempted for GAP only, and only in --recover mode. This
    // branch is the entire boundary - DUPLICATE and OK never reach it,
    // regardless of local state, by construction rather than a runtime
    // check that could be bypassed.
    if (classification === 'GAP' && recover) {
      const canonicalEvent = toCanonicalEvent(event.payload);
      const result = await recoverStaleDistributorOnboardingOperation(canonicalEvent, staleAfterMs!);
      if (result.reclaimed) {
        recoveredCount++;
        console.log(
          `  RECOVERED    - business operation ${correlationId}: foundExisting=${result.foundExisting}, ` +
            `incident=${result.incident?.number} (${result.incident?.sysId})`
        );
      } else {
        notRecoveredCount++;
        console.log(
          `  NOT RECOVERED - business operation ${correlationId} could not be reclaimed this run ` +
            '(no local durable record, not yet stale under this threshold, or already completed ' +
            'locally) - remains an unresolved GAP, not silently treated as recovered.'
        );
      }
    }
  }

  console.log(
    `\nSummary: ${events.length} event(s) - ` +
      `UNEVALUABLE=${tally.UNEVALUABLE} GAP=${tally.GAP} OK=${tally.OK} DUPLICATE=${tally.DUPLICATE}`
  );
  if (recover) {
    console.log(`Recovery: ${recoveredCount} recovered, ${notRecoveredCount} GAP(s) not recovered this run.`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
