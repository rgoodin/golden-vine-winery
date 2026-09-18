import { randomUUID } from 'crypto';
import { config } from '../src/config';
import { authenticate } from '../src/servicenow/auth';
import { acquireOperation } from 'golden-path-reliability';
import { createOnboardingIncident } from '../src/servicenow/incidentAdapter';
import { recoverStaleDistributorOnboardingOperation } from '../src/recoverStaleDistributorOnboardingOperation';
import { DistributorOnboardingRequestedEvent } from '../src/types/events';

/**
 * Enablement-round verification (docs/decisions/0005-external-side-effect-reliability-contract.md),
 * NOT another architectural investigation - both crash boundaries and
 * concurrent reclaim were already established experimentally (OB-0020,
 * OB-0021). This confirms the PRODUCTION abstractions
 * (src/reliability/idempotencyStore.ts's reclaimOperation,
 * src/servicenow/incidentReconciliation.ts,
 * src/recoverStaleDistributorOnboardingOperation.ts) preserve those
 * properties when driven through the real functions, not a
 * reimplementation of them.
 *
 * Case 1 and 2 reproduce the crash boundaries using the smallest
 * controlled test mechanism appropriate here: calling
 * acquireOperation() (and, for Case 2, createOnboardingIncident())
 * directly and then simply not calling completeOperation() - exactly
 * what a real crash at that point would leave behind - rather than any
 * special test-only bypass. A short staleAfterMs (passed by this
 * script, not hardcoded anywhere in production code) stands in for
 * whatever threshold a real recovery caller would choose.
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
      name: 'Tier1 Recovery Enablement Test Distributor',
      primaryContact: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    },
    sales: {
      opportunityId: '006000000000002',
      accountId: '001000000000002',
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

async function runCase1() {
  console.log('\n=== Case 1: crash before ServiceNow -> recovery should CREATE the Incident ===');
  const id = randomUUID();
  const event = makeEvent(id, randomUUID());
  console.log(`Business operation under test: ${id}`);

  acquireOperation(id);
  console.log('Acquired locally, simulating a crash before createOnboardingIncident() was ever called.');

  console.log(`Waiting ${STALE_AFTER_MS + 500}ms so the operation becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);

  const result = await recoverStaleDistributorOnboardingOperation(event, STALE_AFTER_MS);
  console.log('Recovery result:', JSON.stringify(result));

  const incidents = await verifyIncidents(id);
  console.log(`Independently verified Incidents for ${id}: ${incidents.length}`);
  console.table(incidents);

  const pass = result.reclaimed && result.foundExisting === false && incidents.length === 1;
  console.log(pass ? 'Case 1: PASS' : 'Case 1: FAIL - investigate before trusting recovery.');
  return pass;
}

async function runCase2() {
  console.log('\n=== Case 2: crash after ServiceNow, before local completion -> recovery should DISCOVER, not duplicate ===');
  const id = randomUUID();
  const event = makeEvent(id, randomUUID());
  console.log(`Business operation under test: ${id}`);

  acquireOperation(id);
  const original = await createOnboardingIncident(event);
  console.log(`ServiceNow Incident actually created: ${original.number} (${original.sysId}); local state left in_flight (simulated crash before completeOperation()).`);

  console.log(`Waiting ${STALE_AFTER_MS + 500}ms so the operation becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);

  const result = await recoverStaleDistributorOnboardingOperation(event, STALE_AFTER_MS);
  console.log('Recovery result:', JSON.stringify(result));

  const incidents = await verifyIncidents(id);
  console.log(`Independently verified Incidents for ${id}: ${incidents.length}`);
  console.table(incidents);

  const pass =
    result.reclaimed &&
    result.foundExisting === true &&
    result.incident?.sysId === original.sysId &&
    incidents.length === 1;
  console.log(pass ? 'Case 2: PASS' : 'Case 2: FAIL - investigate before trusting recovery.');
  return pass;
}

async function runCase3() {
  console.log('\n=== Case 3: concurrent reclaim of the SAME stale operation, through the production store ===');
  const id = randomUUID();
  const event = makeEvent(id, randomUUID());
  console.log(`Business operation under test: ${id}`);

  acquireOperation(id);
  console.log('Acquired locally, simulating a crash before createOnboardingIncident() was ever called.');

  console.log(`Waiting ${STALE_AFTER_MS + 500}ms so the operation becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);

  console.log('Firing two concurrent recovery attempts for the same business operation...');
  const [resultA, resultB] = await Promise.all([
    recoverStaleDistributorOnboardingOperation(event, STALE_AFTER_MS),
    recoverStaleDistributorOnboardingOperation(event, STALE_AFTER_MS),
  ]);
  console.log('Result A:', JSON.stringify(resultA));
  console.log('Result B:', JSON.stringify(resultB));

  const reclaimers = [resultA, resultB].filter((r) => r.reclaimed).length;
  const incidents = await verifyIncidents(id);
  console.log(`Independently verified Incidents for ${id}: ${incidents.length}`);
  console.table(incidents);

  const pass = reclaimers === 1 && incidents.length === 1;
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
    '\nExplicitly NOT tested here, by construction (recovery is invoked sequentially/deliberately by this ' +
      'script, never while an original owner is genuinely still executing its own ServiceNow call): the ' +
      'slow-but-not-dead owner race (OB-0022). This script cannot and does not claim to resolve it.'
  );

  if (!results.every(Boolean)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
