import { randomUUID } from 'crypto';
import { config } from '../src/config';
import { authenticate } from '../src/servicenow/auth';
import { processDistributorOnboardingEvent } from '../src/processDistributorOnboardingEvent';
import { DistributorOnboardingRequestedEvent } from '../src/types/events';

/**
 * Enablement-round verification (docs/decisions/0005-external-side-effect-reliability-contract.md),
 * NOT another architectural investigation - the durable-ownership gate's
 * concurrent-initial-processing protection was already established
 * experimentally (OB-0017); this confirms the PRODUCTION extraction
 * (src/reliability/idempotencyStore.ts, src/processDistributorOnboardingEvent.ts)
 * preserves that property when driven through the real processing
 * function, not a reimplementation of it.
 *
 * Calls `processDistributorOnboardingEvent` - the exact function
 * `src/index.ts` calls for every real event - directly, twice
 * concurrently, for two synthetic "deliveries" (distinct Salesforce
 * event IDs, matching what two independent subscriber instances
 * receiving the same broadcast Platform Event would each see) of the
 * SAME business-operation ID. Deliberately does not spin up two live
 * Pub/Sub subscriptions: that would also contend over the single-
 * instance checkpoint file (src/salesforce/checkpoint.ts), a separate,
 * pre-existing concern this script is not testing.
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
      name: 'Tier1 Concurrent Enablement Test Distributor',
      primaryContact: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    },
    sales: {
      opportunityId: '006000000000001',
      accountId: '001000000000001',
      owner: 'John Smith',
    },
  };
}

async function verifyIncidents(correlationId: string): Promise<{ number: string; sys_id: string }[]> {
  const { accessToken } = await authenticate();
  const query = new URLSearchParams({
    sysparm_query: `correlation_id=${correlationId}`,
    sysparm_fields: 'number,sys_id',
  });
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { result?: { number: string; sys_id: string }[] };
  return body.result ?? [];
}

async function main() {
  const businessOperationId = randomUUID();
  const eventA = makeEvent(businessOperationId, randomUUID());
  const eventB = makeEvent(businessOperationId, randomUUID());

  console.log(`Business operation under test: ${businessOperationId}`);
  console.log(`Delivery A event ID: ${eventA.eventId}`);
  console.log(`Delivery B event ID: ${eventB.eventId}`);
  console.log(
    '\nCalling the real processDistributorOnboardingEvent() twice concurrently via Promise.all ' +
      '(not sequentially) for two deliveries of the same business operation...\n'
  );

  const [resultA, resultB] = await Promise.all([
    processDistributorOnboardingEvent(eventA),
    processDistributorOnboardingEvent(eventB),
  ]);

  console.log('\nResult A:', JSON.stringify(resultA));
  console.log('Result B:', JSON.stringify(resultB));

  const createdCount = [resultA, resultB].filter((r) => r.created).length;
  console.log(`\n${createdCount} of 2 concurrent deliveries created an Incident (expected: 1).`);

  console.log('\nIndependently verifying against ServiceNow (not trusting the function results alone)...');
  const incidents = await verifyIncidents(businessOperationId);
  console.log(`Incidents found for this business operation: ${incidents.length}`);
  console.table(incidents);

  if (createdCount === 1 && incidents.length === 1) {
    console.log(
      '\nPASS: the durable ownership gate allowed exactly one of two concurrent deliveries to create ' +
        'an Incident, through the real production code path.'
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
