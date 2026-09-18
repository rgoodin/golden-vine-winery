import { randomUUID } from 'crypto';
import { config } from '../src/config';
import { authenticate } from '../src/sharepoint/auth';
import { processDistributorDocumentWorkspaceRequest } from '../src/processDistributorDocumentWorkspaceRequest';
import { DistributorOnboardingRequestedEvent } from '../src/types/events';

/**
 * Transferability verification for Developer #2 (docs/golden-path/verify.md),
 * NOT another architectural investigation - concurrent-initial-processing
 * protection was already established experimentally against the
 * original mechanism (OB-0017) and confirmed again for
 * services/integration-service's own production extraction. This
 * confirms golden-path-reliability, unmodified, provides the same
 * property when driven through THIS service's own processing function
 * against a completely different target (SharePoint, not ServiceNow).
 *
 * Calls `processDistributorDocumentWorkspaceRequest` - the exact
 * function src/index.ts calls for every real event - directly, twice
 * concurrently, for two synthetic deliveries of the SAME business
 * operation. Deliberately does not spin up two live Pub/Sub
 * subscriptions, for the same reason integration-service's equivalent
 * script doesn't.
 */

function makeEvent(correlationId: string, eventId: string): DistributorOnboardingRequestedEvent {
  return {
    eventType: 'DistributorOnboardingRequested',
    eventVersion: '1.0',
    eventId,
    correlationId,
    timestamp: new Date().toISOString(),
    distributor: {
      externalId: 'EXT-CONCURRENT-TEST',
      name: 'Concurrent Enablement Test Distributor',
      primaryContact: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    },
    sales: {
      opportunityId: '006000000000001',
      accountId: '001000000000001',
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

async function main() {
  const businessOperationId = randomUUID();
  const eventA = makeEvent(businessOperationId, randomUUID());
  const eventB = makeEvent(businessOperationId, randomUUID());

  console.log(`Business operation under test: ${businessOperationId}`);
  console.log(`Delivery A event ID: ${eventA.eventId}`);
  console.log(`Delivery B event ID: ${eventB.eventId}`);
  console.log(
    '\nCalling the real processDistributorDocumentWorkspaceRequest() twice concurrently via Promise.all ' +
      '(not sequentially) for two deliveries of the same business operation...\n'
  );

  const [resultA, resultB] = await Promise.all([
    processDistributorDocumentWorkspaceRequest(eventA),
    processDistributorDocumentWorkspaceRequest(eventB),
  ]);

  console.log('\nResult A:', JSON.stringify(resultA));
  console.log('Result B:', JSON.stringify(resultB));

  const createdCount = [resultA, resultB].filter((r) => r.created).length;
  console.log(`\n${createdCount} of 2 concurrent deliveries created a workspace folder (expected: 1).`);

  console.log('\nIndependently verifying against SharePoint (not trusting the function results alone)...');
  const folders = await verifyWorkspaceFolders(businessOperationId);
  console.log(`Workspace folders found for this business operation: ${folders.length}`);
  console.table(folders);

  if (createdCount === 1 && folders.length === 1) {
    console.log(
      '\nPASS: golden-path-reliability, unmodified, allowed exactly one of two concurrent deliveries to ' +
        'create a SharePoint workspace folder, through this service\'s own real production code path.'
    );
  } else {
    console.log('\nUNEXPECTED result - investigate before treating the gate as working.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
