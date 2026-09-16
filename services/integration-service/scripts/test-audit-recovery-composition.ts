import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { authenticate as sfAuthenticate } from '../src/salesforce/auth';
import { authenticate as snAuthenticate } from '../src/servicenow/auth';
import { config } from '../src/config';
import { acquireOperation, getOperation } from '../src/reliability/idempotencyStore';
import { createOnboardingIncident } from '../src/servicenow/incidentAdapter';
import { DistributorOnboardingRequestedEvent } from '../src/types/events';

/**
 * Enablement-round verification for the audit/recovery composition
 * (docs/decisions/0006-tier1-recovery-payload-sourcing.md, this round).
 * NOT another reliability or payload-sourcing investigation - OB-0026
 * and OB-0027/ADR 0006 already established the pieces being composed
 * here. This confirms the COMPOSITION - scripts/detect-unprocessed-events.ts's
 * new `--recover=<ms>` mode - by invoking the REAL, unmodified CLI as a
 * subprocess (exactly as an operator would run it), not by calling the
 * underlying functions directly from a bespoke harness.
 *
 * Three cases, all using events published fresh in this run (a live
 * check just showed Salesforce's EARLIEST sweep now returns 0 events
 * for events published in earlier rounds - see this round's
 * observations for what that means for ADR 0006):
 *
 *   Case 1 - recoverable GAP: acquired locally, no ServiceNow call
 *   (OB-0026's Case 1 shape). Expect: classified GAP, RECOVERED,
 *   exactly one real Incident, local state completed, re-audit shows OK.
 *
 *   Case 2 - unresolvable GAP: published, never acquired locally at
 *   all. Expect: classified GAP, NOT RECOVERED (reclaim finds no local
 *   row), remains GAP on re-audit - proving recovery being *requested*
 *   never marks an unresolved GAP as completed.
 *
 *   Case 3 - DUPLICATE: two real Incidents created directly for the
 *   same correlationId, no local durable record at all. Expect:
 *   classified DUPLICATE, recovery never attempted (no RECOVERED/NOT
 *   RECOVERED line at all), no third Incident created, local state
 *   stays untouched (no row - recovery was never invoked for it).
 */

const STALE_AFTER_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeEvent(correlationId: string, distributorName: string): { payload: Record<string, unknown> } {
  return {
    payload: {
      Event_Id__c: randomUUID(),
      Event_Version__c: '1.0',
      Correlation_Id__c: correlationId,
      Distributor_Name__c: distributorName,
      Distributor_External_Id__c: 'EXT-AUDIT-RECOVERY-TEST',
      Primary_Contact_Name__c: 'Jane Doe',
      Primary_Contact_Email__c: 'jane.doe@example.com',
      Opportunity_Id__c: '006000000000004',
      Account_Id__c: '001000000000004',
      Sales_Owner__c: 'John Smith',
    },
  };
}

async function publish(correlationId: string, distributorName: string): Promise<void> {
  const { payload } = makeEvent(correlationId, distributorName);
  const { accessToken, instanceUrl } = await sfAuthenticate();
  const objectApiName = config.salesforce.pubsubTopic.replace(/^\/event\//, '');
  const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/${objectApiName}/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Publish failed (${response.status}): ${JSON.stringify(body)}`);
  }
}

function canonicalEventFor(correlationId: string, distributorName: string): DistributorOnboardingRequestedEvent {
  return {
    eventType: 'DistributorOnboardingRequested',
    eventVersion: '1.0',
    eventId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    distributor: {
      externalId: 'EXT-AUDIT-RECOVERY-TEST',
      name: distributorName,
      primaryContact: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    },
    sales: { opportunityId: '006000000000004', accountId: '001000000000004', owner: 'John Smith' },
  };
}

async function verifyIncidents(correlationId: string): Promise<{ number: string; sys_id: string }[]> {
  const { accessToken } = await snAuthenticate();
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

function runAudit(recoverMs: number | null): string {
  const args = ['ts-node', 'scripts/detect-unprocessed-events.ts'];
  if (recoverMs !== null) {
    args.push(`--recover=${recoverMs}`);
  }
  console.log(`\n--- running: npx ${args.join(' ')} ---`);
  const output = execFileSync('npx', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  console.log(output);
  return output;
}

function linesFor(output: string, correlationId: string): string[] {
  return output.split('\n').filter((line) => line.includes(correlationId));
}

async function main() {
  const case1Id = randomUUID(); // recoverable GAP
  const case2Id = randomUUID(); // unresolvable GAP (never acquired locally)
  const case3Id = randomUUID(); // DUPLICATE

  console.log(`Case 1 (recoverable GAP) business operation: ${case1Id}`);
  console.log(`Case 2 (unresolvable GAP) business operation: ${case2Id}`);
  console.log(`Case 3 (DUPLICATE) business operation: ${case3Id}`);

  // --- Case 1 setup: acquired locally, no ServiceNow call (crash-before-side-effect shape) ---
  await publish(case1Id, 'Audit Recovery Test - Case 1 - Recoverable GAP');
  acquireOperation(case1Id);
  console.log('Case 1: published + acquired locally, no ServiceNow call made.');

  // --- Case 2 setup: published, never acquired locally at all ---
  await publish(case2Id, 'Audit Recovery Test - Case 2 - Unresolvable GAP');
  console.log('Case 2: published only, no local acquire.');

  // --- Case 3 setup: two real Incidents for the same correlationId, no local record ---
  const eventForCase3 = canonicalEventFor(case3Id, 'Audit Recovery Test - Case 3 - Duplicate');
  const incidentA = await createOnboardingIncident(eventForCase3);
  const incidentB = await createOnboardingIncident(eventForCase3);
  await publish(case3Id, 'Audit Recovery Test - Case 3 - Duplicate');
  console.log(`Case 3: two real Incidents created directly (${incidentA.number}, ${incidentB.number}), then published.`);

  console.log(`\nWaiting ${STALE_AFTER_MS + 500}ms so Case 1's acquired operation becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);

  // --- Run the real, unmodified CLI in AUDIT + RECOVER mode ---
  const recoverOutput = runAudit(STALE_AFTER_MS);

  const case1Lines = linesFor(recoverOutput, case1Id);
  const case2Lines = linesFor(recoverOutput, case2Id);
  const case3Lines = linesFor(recoverOutput, case3Id);

  const case1Recovered = case1Lines.some((l) => l.includes('RECOVERED') && !l.includes('NOT RECOVERED'));
  const case1ClassifiedGap = case1Lines.some((l) => l.trim().startsWith('GAP'));
  const case2NotRecovered = case2Lines.some((l) => l.includes('NOT RECOVERED'));
  const case2ClassifiedGap = case2Lines.some((l) => l.trim().startsWith('GAP'));
  const case3ClassifiedDuplicate = case3Lines.some((l) => l.trim().startsWith('DUPLICATE'));
  const case3RecoveryAttempted = case3Lines.some((l) => l.includes('RECOVERED') || l.includes('NOT RECOVERED'));

  console.log('\n=== CLI output analysis ===');
  console.log(`Case 1: classified GAP=${case1ClassifiedGap}, RECOVERED=${case1Recovered}`);
  console.log(`Case 2: classified GAP=${case2ClassifiedGap}, NOT RECOVERED=${case2NotRecovered}`);
  console.log(`Case 3: classified DUPLICATE=${case3ClassifiedDuplicate}, recovery attempted=${case3RecoveryAttempted} (expected: false)`);

  // --- Independent verification against ServiceNow ---
  const case1Incidents = await verifyIncidents(case1Id);
  const case2Incidents = await verifyIncidents(case2Id);
  const case3Incidents = await verifyIncidents(case3Id);

  console.log('\n=== Independent ServiceNow verification ===');
  console.log(`Case 1 Incidents: ${case1Incidents.length} (expected: 1)`);
  console.table(case1Incidents);
  console.log(`Case 2 Incidents: ${case2Incidents.length} (expected: 0)`);
  console.table(case2Incidents);
  console.log(`Case 3 Incidents: ${case3Incidents.length} (expected: 2, unchanged from setup)`);
  console.table(case3Incidents);

  // --- Independent verification of local durable state ---
  const case1Local = getOperation(case1Id);
  const case2Local = getOperation(case2Id);
  const case3Local = getOperation(case3Id);

  console.log('\n=== Local durable state ===');
  console.log('Case 1:', JSON.stringify(case1Local));
  console.log('Case 2:', JSON.stringify(case2Local), '(expected: null - never acquired, never created by recovery)');
  console.log('Case 3:', JSON.stringify(case3Local), '(expected: null - recovery never touches DUPLICATE)');

  // --- Re-run audit-only (no --recover) and confirm classifications now ---
  const auditOnlyOutput = runAudit(null);
  const case1AfterLines = linesFor(auditOnlyOutput, case1Id);
  const case2AfterLines = linesFor(auditOnlyOutput, case2Id);
  const case3AfterLines = linesFor(auditOnlyOutput, case3Id);

  const case1NowOk = case1AfterLines.some((l) => l.trim().startsWith('OK'));
  const case2StillGap = case2AfterLines.some((l) => l.trim().startsWith('GAP'));
  const case3StillDuplicate = case3AfterLines.some((l) => l.trim().startsWith('DUPLICATE'));

  console.log('\n=== Re-audit (no --recover) ===');
  console.log(`Case 1 now classified OK: ${case1NowOk} (expected: true - was GAP, now recovered)`);
  console.log(`Case 2 still classified GAP: ${case2StillGap} (expected: true - was never recoverable this run)`);
  console.log(`Case 3 still classified DUPLICATE: ${case3StillDuplicate} (expected: true - unchanged, untouched)`);

  // --- Pass/fail summary ---
  const case1Pass =
    case1ClassifiedGap && case1Recovered && case1Incidents.length === 1 && case1Local?.status === 'completed' && case1NowOk;
  const case2Pass =
    case2ClassifiedGap &&
    case2NotRecovered &&
    case2Incidents.length === 0 &&
    case2Local === null &&
    case2StillGap;
  const case3Pass =
    case3ClassifiedDuplicate &&
    !case3RecoveryAttempted &&
    case3Incidents.length === 2 &&
    case3Local === null &&
    case3StillDuplicate;

  console.log('\n=== Summary ===');
  console.log(`Case 1 (recoverable GAP -> RECOVERED -> OK): ${case1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Case 2 (unresolvable GAP stays GAP, never falsely completed): ${case2Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Case 3 (DUPLICATE never routed through recovery): ${case3Pass ? 'PASS' : 'FAIL'}`);

  if (!(case1Pass && case2Pass && case3Pass)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
