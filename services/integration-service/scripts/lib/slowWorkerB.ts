import { authenticate } from '../../src/servicenow/auth';
import { config } from '../../src/config';
import { openStore, reclaim, markCompleted } from './idempotencyStore';

/**
 * Worker B ("recovery owner") for the slow-owner-race experiment
 * (docs/devex/observations.md OB-0022). Runs as a genuinely separate OS
 * process, started while Worker A is still alive and working - not
 * simulating a crash, waiting for Worker A's record to become stale by
 * elapsed time, then reclaiming and reconciling exactly as the existing
 * Candidate C prototype does (docs/architecture/0001-reliability-architecture-spike.md
 * "C-reconciliation").
 *
 * CLI args: <businessOperationId> <staleAfterMs> <waitBeforeReclaimMs>
 *
 * Deliberately does NOT check whether Worker A is still alive before
 * reclaiming - per this experiment's constraint not to implement any
 * heartbeat/fencing/architectural fix, this reflects exactly what the
 * existing prototype does today: elapsed time is the only signal it
 * has.
 */
async function main() {
  const [businessOperationId, staleAfterMsArg, waitBeforeReclaimMsArg] = process.argv.slice(2);
  const staleAfterMs = Number(staleAfterMsArg);
  const waitBeforeReclaimMs = Number(waitBeforeReclaimMsArg);
  if (!businessOperationId || !Number.isFinite(staleAfterMs) || !Number.isFinite(waitBeforeReclaimMs)) {
    throw new Error('Usage: slowWorkerB.ts <businessOperationId> <staleAfterMs> <waitBeforeReclaimMs>');
  }

  console.log(`WORKER_B_WAITING:${JSON.stringify({ waitBeforeReclaimMs })}`);
  await new Promise((resolve) => setTimeout(resolve, waitBeforeReclaimMs));

  const db = openStore();
  const reclaimed = reclaim(db, businessOperationId, staleAfterMs);
  console.log(`WORKER_B_RECLAIM:${JSON.stringify({ reclaimed, at: new Date().toISOString() })}`);
  if (!reclaimed) {
    console.log('WORKER_B_STOPPED:reclaim did not succeed');
    return;
  }

  const { accessToken } = await authenticate();

  const query = new URLSearchParams({
    sysparm_query: `u_gv_business_operation_id=${businessOperationId}`,
    sysparm_fields: 'number,sys_id',
  });
  const reconcileResponse = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const reconcileBody = (await reconcileResponse.json()) as { result?: { number: string; sys_id: string }[] };
  const existing = reconcileBody.result ?? [];
  console.log(`WORKER_B_RECONCILE:${JSON.stringify({ foundExisting: existing.length > 0, existing })}`);

  if (existing.length > 0) {
    const [found] = existing;
    markCompleted(db, businessOperationId, found.sys_id, found.number);
    console.log(`WORKER_B_COMPLETED_FROM_RECONCILE:${JSON.stringify({ sysId: found.sys_id, number: found.number })}`);
    return;
  }

  const createResponse = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      short_description: `Slow-worker race experiment (Worker B recovery): ${businessOperationId}`,
      u_gv_business_operation_id: businessOperationId,
    }),
  });
  const createBody = (await createResponse.json()) as { result?: { sys_id: string; number: string } };
  if (!createResponse.ok) {
    console.log(`WORKER_B_SERVICENOW_ERROR:${JSON.stringify({ status: createResponse.status, body: createBody })}`);
    process.exit(1);
  }
  const incident = { sysId: createBody.result!.sys_id, number: createBody.result!.number };
  console.log(`WORKER_B_SERVICENOW_RESULT:${JSON.stringify(incident)}`);

  markCompleted(db, businessOperationId, incident.sysId, incident.number);
  console.log(`WORKER_B_COMPLETED:${JSON.stringify({ completedAt: new Date().toISOString() })}`);
}

main().catch((err) => {
  console.error(`WORKER_B_FATAL:${JSON.stringify({ message: err.message })}`);
  process.exit(1);
});
