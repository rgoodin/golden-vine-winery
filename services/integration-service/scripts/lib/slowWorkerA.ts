import { authenticate } from '../../src/servicenow/auth';
import { config } from '../../src/config';
import { openStore, acquire, markCompleted } from './idempotencyStore';

/**
 * Worker A ("original owner") for the slow-owner-race experiment
 * (docs/devex/observations.md OB-0022). Runs as a genuinely separate OS
 * process (spawned by scripts/test-durable-state-slow-worker-race.ts),
 * not a setTimeout callback in the same process as Worker B - it has its
 * own Node runtime, its own module state, and can remain "alive" for
 * real while Worker B independently operates against the same durable
 * store and ServiceNow target.
 *
 * CLI args: <businessOperationId> <delayBeforeServiceNowMs>
 *
 * Behavior: acquire ownership, wait the given delay (simulating real,
 * still-in-progress work - not a crash), THEN call ServiceNow for real,
 * then mark completion. Deliberately does no fencing/ownership check
 * before completing - per this experiment's constraint not to implement
 * any architectural fix, this reflects exactly what the existing
 * Candidate C prototype does today.
 */
async function main() {
  const [businessOperationId, delayMsArg] = process.argv.slice(2);
  const delayMs = Number(delayMsArg);
  if (!businessOperationId || !Number.isFinite(delayMs)) {
    throw new Error('Usage: slowWorkerA.ts <businessOperationId> <delayBeforeServiceNowMs>');
  }

  const db = openStore();
  const acquired = acquire(db, businessOperationId);
  const acquiredAt = new Date().toISOString();
  console.log(`WORKER_A_ACQUIRE:${JSON.stringify({ acquired, acquiredAt })}`);
  if (!acquired) {
    throw new Error('Worker A failed to acquire a fresh business-operation ID - unexpected.');
  }

  console.log(`WORKER_A_WAITING:${JSON.stringify({ delayMs })}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const { accessToken } = await authenticate();
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      short_description: `Slow-worker race experiment (Worker A): ${businessOperationId}`,
      u_gv_business_operation_id: businessOperationId,
    }),
  });
  const body = (await response.json()) as { result?: { sys_id: string; number: string } };
  if (!response.ok) {
    console.log(`WORKER_A_SERVICENOW_ERROR:${JSON.stringify({ status: response.status, body })}`);
    process.exit(1);
  }
  const incident = { sysId: body.result!.sys_id, number: body.result!.number };
  console.log(`WORKER_A_SERVICENOW_RESULT:${JSON.stringify(incident)}`);

  markCompleted(db, businessOperationId, incident.sysId, incident.number);
  console.log(`WORKER_A_COMPLETED:${JSON.stringify({ completedAt: new Date().toISOString() })}`);
}

main().catch((err) => {
  console.error(`WORKER_A_FATAL:${JSON.stringify({ message: err.message })}`);
  process.exit(1);
});
