import { createDistributorWorkspaceFolder } from '../../src/sharepoint/workspaceAdapter';
import { DistributorOnboardingRequestedEvent } from '../../src/types/events';

/**
 * Experiment 1 worker for the SharePoint target-side uniqueness
 * investigation (docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md).
 * Runs as a genuinely separate OS process (spawned by
 * scripts/test-concurrent-create-race.ts), not a Promise.all callback
 * sharing one event loop - this isolates the question "does SharePoint
 * itself ever let two folders with the identical name exist" from this
 * project's own local reliability store, which is never touched here.
 *
 * CLI args: <correlationId> <distributorName> <role>
 *
 * Calls the real, unmodified production adapter
 * (createDistributorWorkspaceFolder, conflictBehavior "fail") directly -
 * no reimplementation of the Graph call, per
 * docs/devex/phase-2-observation-review.md Finding 7. Both processes are
 * given the IDENTICAL correlationId/distributorName, so both compute the
 * identical target folder name (workspaceFolderName.ts) and race to
 * create it.
 */
async function main() {
  const [correlationId, distributorName, role] = process.argv.slice(2);
  if (!correlationId || !distributorName || !role) {
    throw new Error('Usage: rawCreateRaceWorker.ts <correlationId> <distributorName> <role>');
  }

  const event: DistributorOnboardingRequestedEvent = {
    eventType: 'DistributorOnboardingRequested',
    eventVersion: '1.0',
    eventId: `race-${role}-${correlationId}`,
    correlationId,
    timestamp: new Date().toISOString(),
    distributor: {
      externalId: 'EXT-RACE-TEST',
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
    console.log(`RACE_WORKER_${role}_SUCCESS:${JSON.stringify({ id: folder.id, name: folder.name })}`);
  } catch (err: any) {
    console.log(`RACE_WORKER_${role}_ERROR:${JSON.stringify({ message: err.message })}`);
  }
}

main().catch((err) => {
  console.error(`RACE_WORKER_FATAL:${JSON.stringify({ message: err.message })}`);
  process.exit(1);
});
