import { randomUUID } from 'crypto';
import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';
import { openStore, acquire, reclaim, markCompleted, getRecord } from './lib/idempotencyStore';

/**
 * Investigation-only follow-up to OB-0018 (the crash-gap silent-loss
 * failure mode). Answers one question: can a stale 'in_flight' record be
 * safely reclaimed after a crash, without reintroducing the duplicate
 * failure Candidate C was meant to prevent (OB-0014)?
 *
 * Does NOT assume elapsed time alone makes reclamation safe - it tests
 * that assumption directly, against two crash boundaries that leave the
 * SAME durable record shape but represent different real-world states:
 *
 * Case 1: crash BEFORE the ServiceNow side effect. Reclaiming and
 * retrying should be safe - nothing happened yet.
 *
 * Case 2: crash AFTER the ServiceNow side effect succeeds, but BEFORE
 * that success is durably recorded (markCompleted never runs). Naively
 * reclaiming and retrying should NOT be safe - it repeats a side effect
 * that already happened.
 *
 * The point of this script is to show, with independent ServiceNow
 * verification, that the durable record alone cannot tell these two
 * cases apart - not to demonstrate a fix. No reclaim safeguard beyond a
 * bare elapsed-time check is implemented (see scripts/lib/idempotencyStore.ts).
 */

async function createIncident(
  accessToken: string,
  businessOperationId: string
): Promise<{ sysId: string; number: string }> {
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      short_description: `Reclaim ambiguity experiment: ${businessOperationId}`,
      u_gv_business_operation_id: businessOperationId,
    }),
  });
  const body = (await response.json()) as { result?: { sys_id: string; number: string } };
  if (!response.ok) {
    throw new Error(`ServiceNow Incident creation failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { sysId: body.result!.sys_id, number: body.result!.number };
}

async function verifyIncidents(
  accessToken: string,
  businessOperationId: string
): Promise<{ number: string; sys_id: string }[]> {
  const query = new URLSearchParams({
    sysparm_query: `u_gv_business_operation_id=${businessOperationId}`,
    sysparm_fields: 'number,sys_id',
  });
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { result?: { number: string; sys_id: string }[] };
  return body.result ?? [];
}

const STALE_AFTER_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { accessToken } = await authenticate();
  const idCase1 = randomUUID();
  const idCase2 = randomUUID();

  console.log('=== Setup: produce two crashed operations with the SAME durable-record shape ===\n');

  console.log(`Case 1 ID: ${idCase1} - will crash BEFORE calling ServiceNow`);
  let db = openStore();
  acquire(db, idCase1);
  db.close();

  console.log(`Case 2 ID: ${idCase2} - will call ServiceNow for real, THEN crash before recording completion`);
  db = openStore();
  acquire(db, idCase2);
  const originalIncident = await createIncident(accessToken, idCase2);
  console.log(`  ServiceNow Incident actually created: ${originalIncident.number} (${originalIncident.sysId})`);
  console.log('  Simulating a crash here - markCompleted() is deliberately never called.');
  db.close();

  console.log('\n=== The durable records, side by side ===');
  db = openStore();
  const record1 = getRecord(db, idCase1);
  const record2 = getRecord(db, idCase2);
  console.log('Case 1 record:', JSON.stringify(record1));
  console.log('Case 2 record:', JSON.stringify(record2));
  const indistinguishable =
    record1?.status === record2?.status &&
    record1?.incidentSysId === record2?.incidentSysId &&
    record1?.incidentNumber === record2?.incidentNumber &&
    record1?.completedAt === record2?.completedAt;
  console.log(
    indistinguishable
      ? '\nCONFIRMED: both records are identical in every field except acquiredAt/businessOperationId - ' +
          'status=in_flight, no incident recorded, no completion timestamp. Nothing in the durable record ' +
          'itself reveals that Case 2 already caused a real ServiceNow side effect and Case 1 did not.'
      : '\nUNEXPECTED: records differ in a way that should not be possible at this point - investigate.'
  );

  console.log(`\n=== Waiting ${STALE_AFTER_MS}ms so both records become genuinely stale (real elapsed time, not simulated) ===`);
  await sleep(STALE_AFTER_MS + 500);

  console.log('\n=== Case 1: reclaim, then complete the operation that never ran ===');
  const reclaimed1 = reclaim(db, idCase1, STALE_AFTER_MS);
  console.log(`Reclaim result: ${reclaimed1}`);
  if (reclaimed1) {
    const incident = await createIncident(accessToken, idCase1);
    markCompleted(db, idCase1, incident.sysId, incident.number);
    console.log(`  Created and recorded: ${incident.number}`);
  }

  console.log('\n=== Case 2: naively reclaim and retry, exactly as Case 1, with no additional check ===');
  const reclaimed2 = reclaim(db, idCase2, STALE_AFTER_MS);
  console.log(`Reclaim result: ${reclaimed2}`);
  if (reclaimed2) {
    const incident = await createIncident(accessToken, idCase2);
    markCompleted(db, idCase2, incident.sysId, incident.number);
    console.log(`  Created and recorded: ${incident.number} (this is a SECOND Incident for the same business operation)`);
  }

  console.log('\n=== Independent verification against ServiceNow (not trusting local state) ===');
  const incidents1 = await verifyIncidents(accessToken, idCase1);
  const incidents2 = await verifyIncidents(accessToken, idCase2);
  console.log(`Case 1 - Incidents found for ${idCase1}: ${incidents1.length}`);
  console.table(incidents1);
  console.log(`Case 2 - Incidents found for ${idCase2}: ${incidents2.length}`);
  console.table(incidents2);

  console.log('\n=== Conclusion ===');
  console.log(
    `Case 1 (crash before side effect, then reclaim+retry): ${incidents1.length} Incident(s). ` +
      (incidents1.length === 1
        ? 'Reclamation correctly completed the operation exactly once.'
        : 'UNEXPECTED result - does not match the hypothesis.')
  );
  console.log(
    `Case 2 (crash after side effect, then naive reclaim+retry): ${incidents2.length} Incident(s). ` +
      (incidents2.length === 2
        ? 'Naive reclamation reintroduced the exact duplicate failure Candidate C was meant to prevent (OB-0014).'
        : 'UNEXPECTED result - does not match the hypothesis.')
  );
  console.log(
    '\nThe durable record could not distinguish these two cases before either reclaim ran - both were ' +
      'status=in_flight with no recorded incident. Elapsed time alone answered "has this been abandoned ' +
      'long enough to retry?" but not "did the abandoned attempt already succeed?". Those are different ' +
      'questions, and only the first one was actually answered here. See docs/devex/lessons-learned.md ' +
      'for what additional evidence (not implemented here) would be needed to answer the second.'
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
