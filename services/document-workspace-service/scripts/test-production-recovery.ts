import { randomUUID } from 'crypto';
import { config } from '../src/config';
import { authenticate } from '../src/sharepoint/auth';
import { acquireOperation } from 'golden-path-reliability';
import { createDistributorWorkspaceFolder } from '../src/sharepoint/workspaceAdapter';
import { recoverStaleDocumentWorkspaceOperation } from '../src/recoverStaleDocumentWorkspaceOperation';
import { DistributorOnboardingRequestedEvent } from '../src/types/events';

/**
 * Transferability verification for Developer #2 (docs/golden-path/verify.md),
 * NOT another architectural investigation - both crash boundaries and
 * concurrent reclaim were already established experimentally (OB-0020,
 * OB-0021) and confirmed again for services/integration-service's own
 * production extraction. This confirms golden-path-reliability's
 * reclaimOperation(), unmodified, preserves those properties when
 * driven through THIS service's own recovery function and its own
 * SharePoint-specific reconciliation (workspaceReconciliation.ts),
 * against a completely different target than ServiceNow.
 *
 * Case 1 and 2 reproduce the crash boundaries the same way
 * integration-service's equivalent script does: calling
 * acquireOperation() (and, for Case 2, createDistributorWorkspaceFolder())
 * directly and then simply not calling completeOperation() - exactly
 * what a real crash at that point would leave behind.
 */

const STALE_AFTER_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeEvent(correlationId: string, eventId: string): DistributorOnboardingRequestedEvent {
  return {
    eventType: 'DistributorOnboardingRequested',
    eventVersion: '1.0',
    eventId,
    correlationId,
    timestamp: new Date().toISOString(),
    distributor: {
      externalId: 'EXT-RECOVERY-TEST',
      name: 'Recovery Enablement Test Distributor',
      primaryContact: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    },
    sales: {
      opportunityId: '006000000000002',
      accountId: '001000000000002',
      owner: 'John Smith',
    },
  };
}

async function verifyWorkspaceFolders(correlationId: string): Promise<{ name: string; id: string }[]> {
  const { accessToken } = await authenticate();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${config.sharepoint.siteId}/drive/root:/${encodeURIComponent(config.sharepoint.workspaceFolder)}:/children`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const body = (await response.json()) as { value?: { id: string; name: string }[] };
  return (body.value ?? []).filter((item) => item.name.startsWith(`${correlationId}__`));
}

async function runCase1() {
  console.log('\n=== Case 1: crash before SharePoint -> recovery should CREATE the folder ===');
  const id = randomUUID();
  const event = makeEvent(id, randomUUID());
  console.log(`Business operation under test: ${id}`);

  acquireOperation(id);
  console.log('Acquired locally, simulating a crash before createDistributorWorkspaceFolder() was ever called.');

  console.log(`Waiting ${STALE_AFTER_MS + 500}ms so the operation becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);

  const result = await recoverStaleDocumentWorkspaceOperation(event, STALE_AFTER_MS);
  console.log('Recovery result:', JSON.stringify(result));

  const folders = await verifyWorkspaceFolders(id);
  console.log(`Independently verified workspace folders for ${id}: ${folders.length}`);
  console.table(folders);

  const pass = result.reclaimed && result.foundExisting === false && folders.length === 1;
  console.log(pass ? 'Case 1: PASS' : 'Case 1: FAIL - investigate before trusting recovery.');
  return pass;
}

async function runCase2() {
  console.log(
    '\n=== Case 2: crash after SharePoint, before local completion -> recovery should DISCOVER, not duplicate ==='
  );
  const id = randomUUID();
  const event = makeEvent(id, randomUUID());
  console.log(`Business operation under test: ${id}`);

  acquireOperation(id);
  const original = await createDistributorWorkspaceFolder(event);
  console.log(
    `SharePoint folder actually created: "${original.name}" (${original.id}); local state left in_flight ` +
      '(simulated crash before completeOperation()).'
  );

  console.log(`Waiting ${STALE_AFTER_MS + 500}ms so the operation becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);

  const result = await recoverStaleDocumentWorkspaceOperation(event, STALE_AFTER_MS);
  console.log('Recovery result:', JSON.stringify(result));

  const folders = await verifyWorkspaceFolders(id);
  console.log(`Independently verified workspace folders for ${id}: ${folders.length}`);
  console.table(folders);

  const pass =
    result.reclaimed &&
    result.foundExisting === true &&
    result.folder?.id === original.id &&
    folders.length === 1;
  console.log(pass ? 'Case 2: PASS' : 'Case 2: FAIL - investigate before trusting recovery.');
  return pass;
}

async function runCase3() {
  console.log('\n=== Case 3: concurrent reclaim of the SAME stale operation, through the production store ===');
  const id = randomUUID();
  const event = makeEvent(id, randomUUID());
  console.log(`Business operation under test: ${id}`);

  acquireOperation(id);
  console.log('Acquired locally, simulating a crash before createDistributorWorkspaceFolder() was ever called.');

  console.log(`Waiting ${STALE_AFTER_MS + 500}ms so the operation becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);

  console.log('Firing two concurrent recovery attempts for the same business operation...');
  const [resultA, resultB] = await Promise.all([
    recoverStaleDocumentWorkspaceOperation(event, STALE_AFTER_MS),
    recoverStaleDocumentWorkspaceOperation(event, STALE_AFTER_MS),
  ]);
  console.log('Result A:', JSON.stringify(resultA));
  console.log('Result B:', JSON.stringify(resultB));

  const reclaimers = [resultA, resultB].filter((r) => r.reclaimed).length;
  const folders = await verifyWorkspaceFolders(id);
  console.log(`Independently verified workspace folders for ${id}: ${folders.length}`);
  console.table(folders);

  const pass = reclaimers === 1 && folders.length === 1;
  console.log(
    pass
      ? 'Case 3: PASS - reclaimOperation() permitted exactly one recovery owner through the production store.'
      : 'Case 3: FAIL - investigate before trusting concurrent reclaim.'
  );
  return pass;
}

async function main() {
  const results = [await runCase1(), await runCase2(), await runCase3()];

  console.log('\n=== Summary ===');
  console.log(`Case 1 (crash before side effect): ${results[0] ? 'RESOLVED' : 'NOT RESOLVED'}`);
  console.log(`Case 2 (crash after side effect, before completion): ${results[1] ? 'RESOLVED' : 'NOT RESOLVED'}`);
  console.log(`Case 3 (concurrent reclaim): ${results[2] ? 'RESOLVED' : 'NOT RESOLVED'}`);
  console.log(
    '\nExplicitly NOT tested here, same as integration-service\'s equivalent script: the slow-but-not-dead ' +
      'owner race (OB-0022). Already demonstrated once against the underlying mechanism - re-deriving it here ' +
      "wouldn't teach anything new about SharePoint specifically (docs/golden-path/verify.md)."
  );

  if (!results.every(Boolean)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
