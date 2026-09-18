import { reclaimOperation, completeOperation } from 'golden-path-reliability';
import { createDistributorWorkspaceFolder } from '../../src/sharepoint/workspaceAdapter';
import { findDistributorWorkspaceFolder } from '../../src/sharepoint/workspaceReconciliation';
import { DistributorOnboardingRequestedEvent } from '../../src/types/events';

/**
 * Worker B ("recovery owner") for the slow-owner-race experiment
 * (docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md).
 * Runs as a genuinely separate OS process, started while Worker A is
 * still alive and working - not simulating a crash, waiting for Worker
 * A's record to become stale by elapsed time, then reclaiming and
 * reconciling exactly as the real production
 * recoverStaleDocumentWorkspaceOperation() does (split into its
 * constituent calls here so this script controls the exact timing).
 *
 * CLI args: <correlationId> <distributorName> <staleAfterMs> <waitBeforeReclaimMs>
 *
 * Deliberately does NOT check whether Worker A is still alive before
 * reclaiming - elapsed time is the only signal the production
 * mechanism has, and this experiment tests that mechanism as it
 * actually exists, not a hypothetical improved version of it.
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

  const reclaimed = reclaimOperation(correlationId, staleAfterMs);
  console.log(`WORKER_B_RECLAIM:${JSON.stringify({ reclaimed, at: new Date().toISOString() })}`);
  if (!reclaimed) {
    console.log('WORKER_B_STOPPED:reclaim did not succeed');
    return;
  }

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

  const existing = await findDistributorWorkspaceFolder(event);
  console.log(`WORKER_B_RECONCILE:${JSON.stringify({ foundExisting: existing !== null, existing })}`);

  if (existing) {
    completeOperation(correlationId, existing.id, existing.name);
    console.log(`WORKER_B_COMPLETED_FROM_RECONCILE:${JSON.stringify(existing)}`);
    return;
  }

  try {
    const folder = await createDistributorWorkspaceFolder(event);
    console.log(`WORKER_B_SHAREPOINT_RESULT:${JSON.stringify(folder)}`);
    completeOperation(correlationId, folder.id, folder.name);
    console.log(`WORKER_B_COMPLETED:${JSON.stringify({ completedAt: new Date().toISOString() })}`);
  } catch (err: any) {
    console.log(`WORKER_B_SHAREPOINT_ERROR:${JSON.stringify({ message: err.message })}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`WORKER_B_FATAL:${JSON.stringify({ message: err.message })}`);
  process.exit(1);
});
