import { randomUUID } from 'crypto';
import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';
import { openStore, acquire, getRecord } from './lib/idempotencyStore';

/**
 * Investigation-only prototype: does the durable-state gate from
 * scripts/test-durable-state-concurrent-idempotency.ts introduce a NEW
 * failure mode symmetric to FL-0016/OB-0010 (checkpoint-before-ServiceNow
 * causes silent loss) if the process crashes between acquiring ownership
 * and actually calling ServiceNow?
 *
 * Preventing duplicates is not sufficient on its own - a mechanism that
 * trades duplicates for permanent silent loss is not an improvement, it's
 * a different failure mode. This deliberately simulates that crash and
 * then a redelivery attempt, to observe rather than assume the outcome.
 *
 * No workaround (reclaim/timeout/recovery) is implemented here - this is
 * investigation only, per the architecture spike's constraints.
 */
async function verifyIncidentCount(accessToken: string, businessOperationId: string): Promise<number> {
  const query = new URLSearchParams({
    sysparm_query: `u_gv_business_operation_id=${businessOperationId}`,
    sysparm_fields: 'number,sys_id',
  });
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { result?: Record<string, unknown>[] };
  return (body.result ?? []).length;
}

async function main() {
  const businessOperationId = randomUUID();
  console.log(`Business operation ID under test: ${businessOperationId}\n`);

  const { accessToken } = await authenticate();

  console.log('--- Phase 1: acquire ownership, then simulate a crash before calling ServiceNow ---');
  let db = openStore();
  const acquired = acquire(db, businessOperationId);
  console.log(`Acquire result: ${acquired}`);
  if (!acquired) {
    throw new Error('Unexpected: acquire failed on a fresh business-operation ID.');
  }
  console.log('Record immediately after acquire:', JSON.stringify(getRecord(db, businessOperationId)));
  console.log(
    'Simulating a crash here: the process would exit right after this line in a real failure, ' +
      'having never called ServiceNow and never marked the record completed. The INSERT above is ' +
      'already durably committed to disk (SQLite auto-commits each statement by default), so this ' +
      'is a faithful simulation - not a JS-variable-only state that would vanish on its own.'
  );
  db.close();

  console.log('\n--- Phase 2: "process restart" - reopen the store fresh ---');
  db = openStore();
  const stuckRecord = getRecord(db, businessOperationId);
  console.log('Record after reopening the store:', JSON.stringify(stuckRecord));
  if (stuckRecord?.status !== 'in_flight') {
    throw new Error('Unexpected: record did not survive the simulated crash as in_flight.');
  }
  console.log('Confirmed: the record survived the "crash" - it is still stuck at in_flight, forever, unless something explicitly reclaims it.');

  console.log('\n--- Phase 3: simulate redelivery (e.g. Salesforce redelivers the event, or the audit tool retries) ---');
  const redeliveryAcquired = acquire(db, businessOperationId);
  console.log(`Redelivery acquire result: ${redeliveryAcquired}`);
  console.log(
    redeliveryAcquired
      ? 'Unexpected: redelivery was allowed to acquire ownership again.'
      : 'Redelivery was blocked. The store cannot distinguish "someone else is genuinely mid-flight right now" ' +
          'from "a prior attempt crashed and never finished" - both look identical: a row already exists.'
  );

  console.log('\n--- Phase 4: independently confirm ServiceNow was never called for this business operation ---');
  const incidentCount = await verifyIncidentCount(accessToken, businessOperationId);
  console.log(`Incidents found in ServiceNow for this business operation ID: ${incidentCount}`);

  console.log('\n--- Conclusion ---');
  if (incidentCount === 0 && !redeliveryAcquired) {
    console.log(
      'Confirmed failure mode: after the simulated crash, this business operation can NEVER produce ' +
        'a ServiceNow Incident again through this path - zero Incidents exist, and every future ' +
        'redelivery attempt for the same ID will be silently blocked by the stuck in_flight row, with ' +
        'no error, no log trail distinguishing it from a legitimate in-progress request, and no automatic ' +
        'recovery. This is the durable-state-layer equivalent of FL-0016/OB-0010\'s checkpoint-before-' +
        'ServiceNow silent loss - preventing the duplicate (OB-0014\'s opposite failure mode) traded it ' +
        'for a permanent, silent loss instead. Acquiring ownership atomically is necessary but not ' +
        'sufficient; a real implementation would need a way to distinguish stuck from active records ' +
        '(e.g. a staleness timeout plus an explicit reclaim path) - deliberately not designed or built here.'
    );
  } else {
    console.log('Result did not match the expected failure mode - investigate before drawing conclusions.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
