import { replayRange } from 'golden-path-salesforce-transport';
import { config } from '../src/config';
import { toCanonicalEvent } from '../src/salesforce/subscriber';
import { listWorkspaceFolders } from '../src/sharepoint/workspaceReconciliation';
import { recoverStaleDocumentWorkspaceOperation } from '../src/recoverStaleDocumentWorkspaceOperation';
import { getOperation } from 'golden-path-reliability';

/**
 * SharePoint audit instrument - the document-workspace-service
 * counterpart to services/integration-service's
 * detect-unprocessed-events.ts, built per
 * docs/devex/phase-6-iteration-review.md Finding 4 (an explicit,
 * deliberate exception to "don't anticipate friction": this is a
 * repetition of an already-validated capability, not speculation).
 *
 * SAME two-mode shape as the ServiceNow version:
 *
 * AUDIT (always runs, always read-only): replays Salesforce events and
 * classifies each against SharePoint's actual state. Never writes to
 * SharePoint, never touches the runtime checkpoint.
 *
 * RECOVERY (opt-in only, via --recover=<staleAfterMs>): for each GAP,
 * hands the already-decoded event straight to
 * recoverStaleDocumentWorkspaceOperation() - the real production
 * recovery function, unchanged. DUPLICATE and OK are never routed
 * through recovery, by construction of the branch below.
 *
 * DIFFERENT solution shape where the target actually differs: ServiceNow
 * has an indexed correlation_id field, so its audit issues one filtered
 * query per event. SharePoint has no such field, so this audit calls
 * listWorkspaceFolders() exactly ONCE per run and classifies every
 * event against that single in-memory snapshot - see that function's
 * own comment (src/sharepoint/workspaceReconciliation.ts) for why, and
 * docs/devex/observations.md for the live verification of this
 * specific behavior (GAP, OK, DUPLICATE, and the empty-site/pagination
 * edge cases).
 *
 * Usage:
 *   npm run detect-unprocessed-events                              # audit only, full sweep
 *   npm run detect-unprocessed-events -- <fromReplayIdBase64>       # audit only, from a known-good position
 *   npm run detect-unprocessed-events -- --recover=<staleAfterMs>   # audit + recover GAPs, full sweep
 *   npm run detect-unprocessed-events -- --recover=<staleAfterMs> <fromReplayIdBase64>
 *
 * `--recover` requires an explicit millisecond value - same refusal to
 * guess a default as the ServiceNow version, for the same reason
 * (ADR 0005/0007: staleAfterMs is a business/customer risk decision,
 * not Platform's to invent).
 *
 * Classification per event with a usable correlationId:
 *   0 matching folders  -> GAP        (recovery attempted only in --recover mode)
 *   1 matching folder   -> OK         (never touched by recovery)
 *   >1 matching folders -> DUPLICATE  (reports folder names as evidence; never touched by recovery)
 *
 * Events with no Correlation_Id__c are UNEVALUABLE, same as the
 * ServiceNow version, for the same reason.
 *
 * UNATTENDED/SCHEDULED EXECUTION: same contract as the ServiceNow
 * version - exits 0 on success, non-zero on failure, nothing more.
 * `checkSweepHealth()` treats a zero-event Salesforce sweep as an
 * unhealthy run (not "no GAPs"), for the same reason ADR 0007 §4
 * established for ServiceNow - this is about Salesforce-side retention
 * behavior, not the target, so the check is identical. A `RUN_SUMMARY:`
 * JSON line is printed at the end of a successful run, same shape.
 */
interface FolderMatch {
  id: string;
  name: string;
}

type Classification = 'UNEVALUABLE' | 'GAP' | 'OK' | 'DUPLICATE';

/**
 * Identical logic to services/integration-service's checkSweepHealth() -
 * this is about whether Salesforce's replay sweep is trustworthy, which
 * has nothing to do with which target is being audited. Duplicated
 * rather than shared for now, per docs/devex/phase-6-iteration-review.md
 * Finding 3's reasoning: two instances of identical logic is not yet
 * evidence a shared package is earned - left here for human review to
 * revisit if a third instance appears.
 */
export function checkSweepHealth(eventCount: number): { healthy: boolean; reason?: string } {
  if (eventCount === 0) {
    return {
      healthy: false,
      reason:
        'sweep returned 0 events - treated as an unhealthy/failed run, not evidence that there are no GAPs ' +
        '(same reasoning as ADR 0007 §4 / FL-0026 for the ServiceNow integration)',
    };
  }
  return { healthy: true };
}

/**
 * Builds a correlationId -> matching-folders index from one bulk
 * SharePoint listing - see listWorkspaceFolders()'s own comment for why
 * this is one call per run, not one per event. A folder's correlationId
 * is the segment before its first "__" (workspaceFolderName.ts) - a
 * folder name that doesn't follow that convention indexes under its
 * own full name, which will simply never match a real correlationId
 * rather than throwing.
 */
function indexFoldersByCorrelationId(folders: FolderMatch[]): Map<string, FolderMatch[]> {
  const index = new Map<string, FolderMatch[]>();
  for (const folder of folders) {
    const correlationId = folder.name.split('__')[0];
    const existing = index.get(correlationId);
    if (existing) {
      existing.push(folder);
    } else {
      index.set(correlationId, [folder]);
    }
  }
  return index;
}

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
      recover = true;
    } else if (!arg.startsWith('--')) {
      from = arg;
    }
  }

  return { from: from ?? 'EARLIEST', recover, staleAfterMs };
}

async function main() {
  const startedAt = new Date();
  const { from, recover, staleAfterMs } = parseArgs(process.argv.slice(2));

  if (recover && (staleAfterMs === null || Number.isNaN(staleAfterMs) || staleAfterMs <= 0)) {
    console.error(
      'Recovery mode requires an explicit staleness threshold: --recover=<milliseconds> (e.g. --recover=120000). ' +
        "Refusing to guess a default - see this file's header comment."
    );
    process.exit(1);
    return;
  }

  console.log(
    recover
      ? `Mode: AUDIT + RECOVER GAPS (--recover=${staleAfterMs}ms). GAP classifications will attempt ` +
          'recovery and MAY create a SharePoint folder for any that are locally reclaimable. ' +
          'OK, DUPLICATE, and UNEVALUABLE remain read-only, exactly as in audit-only mode.'
      : 'Mode: AUDIT ONLY (read-only - no SharePoint writes, no state changes). Pass ' +
          '--recover=<staleAfterMs> to also attempt recovery of GAP classifications.'
  );
  console.log(
    `Replaying events from ${from === 'EARLIEST' ? 'EARLIEST (full sweep)' : `replayId=${from}`}...`
  );
  const events = await replayRange(config.salesforce, config.salesforce.pubsubTopic, from);
  console.log(`Collected ${events.length} event(s) from Salesforce.`);

  const health = checkSweepHealth(events.length);
  if (!health.healthy) {
    console.error(`ANOMALY - ${health.reason}. Not proceeding to classification or recovery.`);
    process.exit(2);
    return;
  }

  console.log('Listing current SharePoint workspace folder state (one bulk read for this whole run)...');
  const folders = await listWorkspaceFolders();
  console.log(`Found ${folders.length} folder(s) under "${config.sharepoint.workspaceFolder}".\n`);
  const foldersByCorrelationId = indexFoldersByCorrelationId(folders);

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

    const matches = foldersByCorrelationId.get(correlationId) ?? [];
    const classification: Classification =
      matches.length === 0 ? 'GAP' : matches.length === 1 ? 'OK' : 'DUPLICATE';
    tally[classification]++;

    const evidence = matches.length > 0 ? ` folders=[${matches.map((f) => f.name).join(', ')}] count=${matches.length}` : '';

    let ageEvidence = '';
    if (classification === 'GAP') {
      const createdDate = event.payload.CreatedDate as number | undefined;
      const ageMs = createdDate ? Date.now() - createdDate : undefined;
      const localRecord = getOperation(correlationId);
      const localDwellMs = localRecord ? Date.now() - new Date(localRecord.acquiredAt).getTime() : undefined;
      ageEvidence =
        (ageMs !== undefined ? ` ageMs=${ageMs}` : '') +
        (localDwellMs !== undefined ? ` localDwellMs=${localDwellMs} localStatus=${localRecord!.status}` : '');
    }

    console.log(
      `${classification.padEnd(12)} - correlationId=${correlationId} ` +
        `distributor="${distributorName}" replayId=${replayId}${evidence}${ageEvidence}`
    );

    if (classification === 'GAP' && recover) {
      const canonicalEvent = toCanonicalEvent(event.payload);
      const result = await recoverStaleDocumentWorkspaceOperation(canonicalEvent, staleAfterMs!);
      if (result.reclaimed) {
        recoveredCount++;
        console.log(
          `  RECOVERED    - business operation ${correlationId}: foundExisting=${result.foundExisting}, ` +
            `folder=${result.folder?.name} (${result.folder?.id})`
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

  const finishedAt = new Date();
  const runSummary = {
    mode: recover ? 'audit+recover' : 'audit',
    from,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    eventsExamined: events.length,
    foldersExamined: folders.length,
    classifications: tally,
    recovery: recover ? { recovered: recoveredCount, notRecovered: notRecoveredCount } : null,
    success: true,
  };
  console.log(`RUN_SUMMARY: ${JSON.stringify(runSummary)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
