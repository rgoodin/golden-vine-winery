import { acquireOperation, completeOperation } from 'golden-path-reliability';
import { createDistributorWorkspaceFolder } from '../../src/sharepoint/workspaceAdapter';
import { DistributorOnboardingRequestedEvent } from '../../src/types/events';

/**
 * Worker A ("original owner") for the slow-owner-race experiment
 * (docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md,
 * reproducing OB-0022's exact structure for a new target). Runs as a
 * genuinely separate OS process (spawned by
 * scripts/test-target-side-uniqueness-race.ts), not a setTimeout
 * callback in the same process as Worker B - it has its own Node
 * runtime and module state, and stays "alive" for real while Worker B
 * independently operates against the same durable store and the same
 * real SharePoint site.
 *
 * CLI args: <correlationId> <distributorName> <delayBeforeSharePointMs>
 *
 * Behavior: acquire ownership (the real production
 * golden-path-reliability function, unmodified), wait the given delay
 * (simulating real, still-in-progress work - not a crash), THEN call
 * SharePoint for real via the real production adapter
 * (createDistributorWorkspaceFolder), then mark completion. Deliberately
 * does no fencing/ownership check before completing - this reflects
 * exactly what the production orchestration does today.
 */
async function main() {
  const [correlationId, distributorName, delayMsArg] = process.argv.slice(2);
  const delayMs = Number(delayMsArg);
  if (!correlationId || !distributorName || !Number.isFinite(delayMs)) {
    throw new Error('Usage: slowWorkerA.ts <correlationId> <distributorName> <delayBeforeSharePointMs>');
  }

  const acquired = acquireOperation(correlationId);
  console.log(`WORKER_A_ACQUIRE:${JSON.stringify({ acquired, acquiredAt: new Date().toISOString() })}`);
  if (!acquired) {
    throw new Error('Worker A failed to acquire a fresh business-operation ID - unexpected.');
  }

  console.log(`WORKER_A_WAITING:${JSON.stringify({ delayMs })}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const event: DistributorOnboardingRequestedEvent = {
    eventType: 'DistributorOnboardingRequested',
    eventVersion: '1.0',
    eventId: `slow-owner-race-a-${correlationId}`,
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
    const folder = await createDistributorWorkspaceFolder(event);
    console.log(`WORKER_A_SHAREPOINT_RESULT:${JSON.stringify(folder)}`);
    completeOperation(correlationId, folder.id, folder.name);
    console.log(`WORKER_A_COMPLETED:${JSON.stringify({ completedAt: new Date().toISOString() })}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`WORKER_A_SHAREPOINT_ERROR:${JSON.stringify({ message })}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`WORKER_A_FATAL:${JSON.stringify({ message: err.message })}`);
  process.exit(1);
});
