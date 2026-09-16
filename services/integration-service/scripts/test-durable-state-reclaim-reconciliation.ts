import { randomUUID } from 'crypto';
import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';
import { openStore, acquire, reclaim, markCompleted, getRecord } from './lib/idempotencyStore';

/**
 * Investigation-only follow-up to OB-0020 (staleness-based reclaim is
 * necessary but not sufficient - it recovers an abandoned operation
 * correctly but reintroduces a duplicate if the abandoned attempt had
 * already succeeded). Answers one question: after atomically reclaiming
 * a stale operation, can querying ServiceNow by business-operation ID
 * distinguish "already happened" from "never happened" well enough to
 * recover both crash cases without either a gap or a duplicate?
 *
 * Reconciliation is used ONLY on the reclaim path, never on normal
 * first-processing - the existing atomic acquire() remains the sole
 * concurrency gate for new work (docs/architecture/0001-reliability-architecture-spike.md
 * Candidate B was already rejected as the primary gate; this does not
 * reopen that question).
 *
 * Repeats OB-0020's exact two cases so the result is directly
 * comparable, then extends the SAME experiment (not a new one) with a
 * third case: do two concurrent reclaim attempts for the same stale ID
 * still produce exactly one recovery owner?
 *
 * Deliberately out of scope, per instruction: a generalized recovery
 * worker, retry framework, heartbeat system, or production state
 * machine. This script's `reconcileAndComplete` is the minimum
 * orchestration needed to run the experiment, not a reusable mechanism.
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
      short_description: `Reclaim reconciliation experiment: ${businessOperationId}`,
      u_gv_business_operation_id: businessOperationId,
    }),
  });
  const body = (await response.json()) as { result?: { sys_id: string; number: string } };
  if (!response.ok) {
    throw new Error(`ServiceNow Incident creation failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { sysId: body.result!.sys_id, number: body.result!.number };
}

/** Independent verification query - not trusted state, a fresh GET each time. */
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

/**
 * The reconciliation step itself: query ServiceNow directly by
 * business-operation ID. Found -> record the discovered Incident as
 * completion, do not create. Absent -> create, then record completion.
 * This is the exact query -> found/absent -> record/create branch from
 * the task's diagram, nothing more.
 */
async function reconcileAndComplete(
  db: ReturnType<typeof openStore>,
  accessToken: string,
  businessOperationId: string
): Promise<{ foundExisting: boolean; incident: { sysId: string; number: string } }> {
  const existing = await verifyIncidents(accessToken, businessOperationId);
  if (existing.length > 0) {
    const [incident] = existing;
    markCompleted(db, businessOperationId, incident.sys_id, incident.number);
    return { foundExisting: true, incident: { sysId: incident.sys_id, number: incident.number } };
  }
  const created = await createIncident(accessToken, businessOperationId);
  markCompleted(db, businessOperationId, created.sysId, created.number);
  return { foundExisting: false, incident: created };
}

const STALE_AFTER_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { accessToken } = await authenticate();

  // ---------------------------------------------------------------
  // Case 1: crash before ServiceNow
  // ---------------------------------------------------------------
  const idCase1 = randomUUID();
  console.log('=== Case 1 setup: acquire, then crash/abandon before calling ServiceNow ===');
  let db = openStore();
  acquire(db, idCase1);
  db.close();

  // ---------------------------------------------------------------
  // Case 2: crash after ServiceNow succeeds, before local completion
  // ---------------------------------------------------------------
  const idCase2 = randomUUID();
  console.log('=== Case 2 setup: acquire, call ServiceNow for real, then crash before recording completion ===');
  db = openStore();
  acquire(db, idCase2);
  const originalIncident = await createIncident(accessToken, idCase2);
  console.log(`  ServiceNow Incident actually created: ${originalIncident.number} (${originalIncident.sysId})`);
  db.close();

  console.log(`\n=== Waiting ${STALE_AFTER_MS}ms so both records become genuinely stale (real elapsed time) ===`);
  await sleep(STALE_AFTER_MS + 500);
  db = openStore();

  console.log('\n=== Case 1: atomic reclaim -> reconcile against ServiceNow ===');
  const reclaimed1 = reclaim(db, idCase1, STALE_AFTER_MS);
  console.log(`Reclaim result: ${reclaimed1}`);
  const result1 = reclaimed1 ? await reconcileAndComplete(db, accessToken, idCase1) : null;
  console.log(
    result1
      ? `Reconciliation: foundExisting=${result1.foundExisting} (expected false - nothing should exist yet), ` +
          `resulting Incident ${result1.incident.number}`
      : 'Reclaim failed - unexpected for a fresh stale record.'
  );

  console.log('\n=== Case 2: atomic reclaim -> reconcile against ServiceNow ===');
  const reclaimed2 = reclaim(db, idCase2, STALE_AFTER_MS);
  console.log(`Reclaim result: ${reclaimed2}`);
  const result2 = reclaimed2 ? await reconcileAndComplete(db, accessToken, idCase2) : null;
  console.log(
    result2
      ? `Reconciliation: foundExisting=${result2.foundExisting} (expected true - the original Incident should ` +
          `be discovered), resulting Incident ${result2.incident.number} ` +
          `(should match the original: ${originalIncident.number})`
      : 'Reclaim failed - unexpected for a fresh stale record.'
  );

  console.log('\n=== Independent verification against ServiceNow (not trusting the prototype\'s own decisions) ===');
  const incidents1 = await verifyIncidents(accessToken, idCase1);
  const incidents2 = await verifyIncidents(accessToken, idCase2);
  console.log(`Case 1 - Incidents found for ${idCase1}: ${incidents1.length}`);
  console.table(incidents1);
  console.log(`Case 2 - Incidents found for ${idCase2}: ${incidents2.length}`);
  console.table(incidents2);

  const case1Clean = incidents1.length === 1;
  const case2Clean = incidents2.length === 1 && incidents2[0].sys_id === originalIncident.sysId;

  console.log('\n--- Case 1/2 result ---');
  console.log(
    `Case 1 (crash before side effect): ${incidents1.length} Incident(s). ` +
      (case1Clean ? 'Correct - recovered exactly once.' : 'UNEXPECTED - does not match the hypothesis.')
  );
  console.log(
    `Case 2 (crash after side effect): ${incidents2.length} Incident(s), matches original: ${
      incidents2[0]?.sys_id === originalIncident.sysId
    }. ` + (case2Clean ? 'Correct - no duplicate created, existing Incident discovered instead.' : 'UNEXPECTED - does not match the hypothesis.')
  );

  // ---------------------------------------------------------------
  // Case 3: concurrent reclaim ownership - does reclaim() still permit
  // only one recovery owner when two attempts race for the SAME stale ID?
  // ---------------------------------------------------------------
  console.log('\n=== Case 3: concurrent reclaim attempts against the SAME stale record ===');
  const idCase3 = randomUUID();
  console.log(`Case 3 ID: ${idCase3} - acquire, then crash/abandon before calling ServiceNow (same shape as Case 1)`);
  db = openStore();
  acquire(db, idCase3);
  db.close();

  console.log(`Waiting ${STALE_AFTER_MS}ms so it becomes genuinely stale...`);
  await sleep(STALE_AFTER_MS + 500);
  db = openStore();

  console.log('Firing two concurrent reclaim attempts for the same ID...');
  const [reclaimA, reclaimB] = await Promise.all([
    Promise.resolve(reclaim(db, idCase3, STALE_AFTER_MS)),
    Promise.resolve(reclaim(db, idCase3, STALE_AFTER_MS)),
  ]);
  console.log(`Reclaim A: ${reclaimA}, Reclaim B: ${reclaimB}`);

  const winners = [reclaimA, reclaimB].filter(Boolean).length;
  let case3IncidentCountAfterWinnerCompletes = 0;
  if (reclaimA) {
    const r = await reconcileAndComplete(db, accessToken, idCase3);
    console.log(`Winner A completed reconciliation: foundExisting=${r.foundExisting}, Incident ${r.incident.number}`);
  }
  if (reclaimB) {
    const r = await reconcileAndComplete(db, accessToken, idCase3);
    console.log(`Winner B completed reconciliation: foundExisting=${r.foundExisting}, Incident ${r.incident.number}`);
  }
  const incidents3 = await verifyIncidents(accessToken, idCase3);
  case3IncidentCountAfterWinnerCompletes = incidents3.length;
  console.log(`Independently verified Incidents for Case 3: ${case3IncidentCountAfterWinnerCompletes}`);
  console.table(incidents3);

  const case3Clean = winners === 1 && case3IncidentCountAfterWinnerCompletes === 1;
  console.log(
    `Case 3 (concurrent reclaim): ${winners} of 2 reclaim attempts succeeded, ${case3IncidentCountAfterWinnerCompletes} Incident(s) resulted. ` +
      (case3Clean
        ? 'Correct - reclaim() permitted exactly one recovery owner, same "constraint decides" guarantee as acquire() (OB-0017).'
        : 'UNEXPECTED - does not match the hypothesis.')
  );

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log('\n=== Summary ===');
  console.log(`Case 1 (crash before side effect): ${case1Clean ? 'RESOLVED' : 'NOT RESOLVED'}`);
  console.log(`Case 2 (crash after side effect, before completion): ${case2Clean ? 'RESOLVED' : 'NOT RESOLVED'}`);
  console.log(`Case 3 (concurrent reclaim ownership): ${case3Clean ? 'RESOLVED' : 'NOT RESOLVED'}`);
  console.log(
    '\nExplicitly NOT tested by this experiment, by construction (a single sequential process, with each ' +
      'phase\'s store handle closed before the next begins - there is no point in this script where an ' +
      'original "worker" is still actually executing while a second worker reclaims): the slow-but-not-dead ' +
      'worker race identified when reclaim() was first built - Worker A\'s ServiceNow call still genuinely ' +
      'in flight when Worker B considers A stale, reclaims, reconciles (finds nothing, because A has not ' +
      'written its result anywhere reconciliation can see yet), and calls ServiceNow itself, followed by A\'s ' +
      'original call finally completing - a possible duplicate this experiment does not produce or rule out. ' +
      'Left explicitly unresolved.'
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
