import { recoverStaleDocumentWorkspaceOperation } from '../../src/recoverStaleDocumentWorkspaceOperation';
import { DistributorOnboardingRequestedEvent } from '../../src/types/events';

/**
 * Worker B ("recovery owner") for the slow-owner-race experiment
 * (docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md).
 * Runs as a genuinely separate OS process, started while Worker A is
 * still alive and working - not simulating a crash, waiting for Worker
 * A's record to become stale by elapsed time, then calling the real
 * production recovery function directly
 * (recoverStaleDocumentWorkspaceOperation) - not a manual
 * reimplementation of its steps, per
 * docs/devex/phase-2-observation-review.md Finding 7. This is what
 * actually re-verifies the create-first recovery shape
 * (docs/devex/observations.md OB-0035) under the genuine race, not a
 * stand-in for it.
 *
 * CLI args: <correlationId> <distributorName> <staleAfterMs> <waitBeforeReclaimMs>
 */
async function main() {
  const [correlationId, distributorName, staleAfterMsArg, waitBeforeReclaimMsArg] = process.argv.slice(2);
  const staleAfterMs = Number(staleAfterMsArg);
  const waitBeforeReclaimMs = Number(waitBeforeReclaimMsArg);
  if (!correlationId || !distributorName || !Number.isFinite(staleAfterMs) || !Number.isFinite(waitBeforeReclaimMs)) {
    throw new Error(
      'Usage: slowWorkerB.ts <correlationId> <distributorName> <staleAfterMs> <waitBeforeReclaimMs>'
    );
  }

  console.log(`WORKER_B_WAITING:${JSON.stringify({ waitBeforeReclaimMs })}`);
  await new Promise((resolve) => setTimeout(resolve, waitBeforeReclaimMs));

  const event: DistributorOnboardingRequestedEvent = {
    eventType: 'DistributorOnboardingRequested',
    eventVersion: '1.0',
    eventId: `slow-owner-race-b-${correlationId}`,
    correlationId,
    timestamp: new Date().toISOString(),
    distributor: {
      externalId: 'EXT-SLOW-OWNER-RACE',
      name: distributorName,
      primaryContact: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    },
    sales: {
      opportunityId: '006000000000001',
      accountId: '001000000000001',
      owner: 'John Smith',
    },
  };

  try {
    const result = await recoverStaleDocumentWorkspaceOperation(event, staleAfterMs);

    console.log(`WORKER_B_RECLAIM:${JSON.stringify({ reclaimed: result.reclaimed, at: new Date().toISOString() })}`);
    if (!result.reclaimed) {
      console.log('WORKER_B_STOPPED:reclaim did not succeed');
      return;
    }

    console.log(`WORKER_B_RECONCILE:${JSON.stringify({ foundExisting: result.foundExisting, existing: result.folder ?? null })}`);
    if (result.foundExisting) {
      console.log(`WORKER_B_COMPLETED_FROM_RECONCILE:${JSON.stringify(result.folder)}`);
    } else {
      console.log(`WORKER_B_SHAREPOINT_RESULT:${JSON.stringify(result.folder)}`);
      console.log(`WORKER_B_COMPLETED:${JSON.stringify({ completedAt: new Date().toISOString() })}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`WORKER_B_SHAREPOINT_ERROR:${JSON.stringify({ message })}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`WORKER_B_FATAL:${JSON.stringify({ message: err.message })}`);
  process.exit(1);
});
