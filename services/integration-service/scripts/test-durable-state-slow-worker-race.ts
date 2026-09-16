import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as path from 'path';
import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';
import { openStore, getRecord } from './lib/idempotencyStore';

/**
 * Investigation-only experiment: reproduces the slow-original-owner race
 * left explicitly unresolved by OB-0020/OB-0021
 * (docs/architecture/0001-reliability-architecture-spike.md
 * "C-reconciliation"). Answers exactly one question:
 *
 * Can the current stale -> atomic reclaim -> target reconciliation
 * mechanism produce duplicate ServiceNow side effects when the original
 * owner is slow rather than dead?
 *
 * Worker A and Worker B (scripts/lib/slowWorkerA.ts,
 * scripts/lib/slowWorkerB.ts) run as genuinely independent OS processes,
 * not setTimeout callbacks sharing one Node process/event loop - each
 * has its own runtime and operates against the same on-disk SQLite
 * store and the same real ServiceNow instance, which is what makes the
 * race genuine rather than simulated.
 *
 * No heartbeat, fencing, target-side uniqueness, retry, or generalized
 * recovery mechanism is implemented here or anywhere else this round -
 * this script only coordinates timing and independently verifies the
 * result. If the mechanism turns out to be unsafe, that is recorded,
 * not patched over to make the experiment "pass".
 */

const STALE_AFTER_MS = 2000;
const WORKER_A_DELAY_MS = 6000; // Worker A's ServiceNow call happens this long after acquiring
const WORKER_B_WAIT_MS = 2500; // Worker B waits this long before attempting reclaim
const WORKER_B_STAGGER_MS = 300; // Worker B's process starts this long after Worker A's

interface WorkerResult {
  exitCode: number | null;
  lines: string[];
}

function runWorker(scriptPath: string, args: string[], serviceRoot: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['ts-node', scriptPath, ...args], {
      cwd: serviceRoot,
      env: process.env,
    });
    const lines: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      chunk
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .forEach((line) => {
          lines.push(line);
          console.log(`  ${line}`);
        });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      chunk
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .forEach((line) => {
          lines.push(line);
          console.error(`  ${line}`);
        });
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, lines }));
  });
}

function parseMarker(lines: string[], marker: string): unknown | null {
  const line = lines.find((l) => l.startsWith(`${marker}:`));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(marker.length + 1));
  } catch {
    return null;
  }
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

interface IterationResult {
  iteration: number;
  businessOperationId: string;
  workerAAcquired: boolean;
  workerBReclaimed: boolean;
  workerBFoundExisting: boolean | null;
  incidentCount: number;
  incidentNumbers: string[];
  localRecordIncidentNumber: string | null;
  duplicate: boolean;
}

async function runIteration(iteration: number, serviceRoot: string, accessToken: string): Promise<IterationResult> {
  const businessOperationId = randomUUID();
  console.log(`\n=== Iteration ${iteration}: ${businessOperationId} ===`);

  const workerAScript = path.join(serviceRoot, 'scripts', 'lib', 'slowWorkerA.ts');
  const workerBScript = path.join(serviceRoot, 'scripts', 'lib', 'slowWorkerB.ts');

  console.log('Spawning Worker A (original owner)...');
  const workerAPromise = runWorker(workerAScript, [businessOperationId, String(WORKER_A_DELAY_MS)], serviceRoot);

  await new Promise((resolve) => setTimeout(resolve, WORKER_B_STAGGER_MS));

  console.log('Spawning Worker B (recovery owner) - Worker A is still alive and waiting...');
  const workerBPromise = runWorker(
    workerBScript,
    [businessOperationId, String(STALE_AFTER_MS), String(WORKER_B_WAIT_MS)],
    serviceRoot
  );

  const [resultA, resultB] = await Promise.all([workerAPromise, workerBPromise]);

  const acquireInfo = parseMarker(resultA.lines, 'WORKER_A_ACQUIRE') as { acquired: boolean } | null;
  const reclaimInfo = parseMarker(resultB.lines, 'WORKER_B_RECLAIM') as { reclaimed: boolean } | null;
  const reconcileInfo = parseMarker(resultB.lines, 'WORKER_B_RECONCILE') as { foundExisting: boolean } | null;

  console.log('\nIndependent verification against ServiceNow (not trusting either worker\'s own report)...');
  const incidents = await verifyIncidents(accessToken, businessOperationId);
  console.table(incidents);

  const db = openStore();
  const localRecord = getRecord(db, businessOperationId);
  console.log('Local durable record after both workers finished:', JSON.stringify(localRecord));

  const duplicate = incidents.length > 1;

  return {
    iteration,
    businessOperationId,
    workerAAcquired: acquireInfo?.acquired ?? false,
    workerBReclaimed: reclaimInfo?.reclaimed ?? false,
    workerBFoundExisting: reconcileInfo ? reconcileInfo.foundExisting : null,
    incidentCount: incidents.length,
    incidentNumbers: incidents.map((i) => i.number),
    localRecordIncidentNumber: localRecord?.incidentNumber ?? null,
    duplicate,
  };
}

async function main() {
  const iterations = Number(process.argv[2] ?? 3);
  const serviceRoot = path.join(__dirname, '..');
  const { accessToken } = await authenticate();

  console.log(
    `Running ${iterations} iterations. Worker A delays ${WORKER_A_DELAY_MS}ms before calling ServiceNow; ` +
      `Worker B waits ${WORKER_B_WAIT_MS}ms (past the ${STALE_AFTER_MS}ms staleness threshold) before reclaiming. ` +
      'This margin is deliberately wide so the dangerous overlap is exercised on every run, not by luck.'
  );

  const results: IterationResult[] = [];
  for (let i = 1; i <= iterations; i++) {
    results.push(await runIteration(i, serviceRoot, accessToken));
  }

  console.log('\n=== Summary across all iterations ===');
  console.table(results);

  const duplicateCount = results.filter((r) => r.duplicate).length;
  console.log(
    `\n${duplicateCount}/${iterations} iterations produced more than one ServiceNow Incident for the same ` +
      'business-operation ID.'
  );
  if (duplicateCount === iterations) {
    console.log(
      'The slow-owner race is CONFIRMED, deterministically, not by lucky scheduling - every iteration used the ' +
        'same wide, fixed timing margin and every iteration produced a duplicate. Worker B correctly followed the ' +
        'existing reclaim + reconciliation logic exactly as designed: it found no Incident (because Worker A had ' +
        'not called ServiceNow yet) and created one, which was the only fact available to it at that moment. ' +
        'Worker A, unaware it had been reclaimed (no fencing token exists to tell it), completed its own real ' +
        'ServiceNow call afterward and overwrote the local completion record with its own Incident - leaving the ' +
        'durable record pointing at only ONE of the two real Incidents that now exist in ServiceNow. Neither ' +
        'worker did anything wrong given the information available to it; the mechanism has no way to give either ' +
        'of them the missing information.'
    );
  } else if (duplicateCount === 0) {
    console.log(
      'No duplicate occurred on any iteration. Before concluding the architecture is safe: check whether this is ' +
        'because Worker B\'s reconciliation query, by chance, ran AFTER Worker A\'s ServiceNow call resolved on ' +
        'every run (i.e. the intended dangerous overlap was not actually exercised), or because something in the ' +
        'mechanism itself prevented it. Given the wide, fixed timing margin used here, a clean run should be ' +
        'treated as suspicious, not reassuring, until the timing logs above are checked.'
    );
  } else {
    console.log('Mixed result - some iterations raced, some did not. Investigate the timing logs above before drawing conclusions.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
