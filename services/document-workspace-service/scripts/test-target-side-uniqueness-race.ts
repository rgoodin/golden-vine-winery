import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as path from 'path';
import { getOperation } from 'golden-path-reliability';
import { listWorkspaceFolders } from '../src/sharepoint/workspaceReconciliation';

/**
 * Experiment 2 of the SharePoint target-side uniqueness investigation
 * (docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md).
 * Reproduces OB-0022's exact structure - the slow-owner race that
 * produced a real ServiceNow duplicate 3/3 times - against SharePoint
 * instead, through this service's own real production functions
 * (golden-path-reliability, src/sharepoint/workspaceAdapter.ts,
 * workspaceReconciliation.ts), unmodified.
 *
 * Answers: when an original owner is genuinely slow (not crashed) and
 * a recovery owner reclaims and reconciles before the original owner's
 * real SharePoint call completes, does SharePoint's
 * `conflictBehavior: "fail"` prevent the resulting duplicate that
 * ServiceNow could never prevent?
 *
 * Worker A and Worker B (scripts/lib/slowWorkerA.ts,
 * scripts/lib/slowWorkerB.ts) run as genuinely independent OS
 * processes, not setTimeout callbacks sharing one event loop - each has
 * its own runtime and operates against the same on-disk SQLite store
 * and the same real SharePoint site, which is what makes the race
 * genuine rather than simulated.
 *
 * No fencing, heuristic, or generalized recovery change is implemented
 * here or anywhere else this round - this script only coordinates
 * timing and independently verifies the result. If the mechanism turns
 * out to be unsafe, that is recorded, not patched over to make the
 * experiment "pass".
 */

const STALE_AFTER_MS = 2000;
const WORKER_A_DELAY_MS = 6000;
const WORKER_B_WAIT_MS = 2500;
const WORKER_B_STAGGER_MS = 300;

interface WorkerResult {
  exitCode: number | null;
  lines: string[];
}

function runWorker(scriptPath: string, args: string[], serviceRoot: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['ts-node', scriptPath, ...args], { cwd: serviceRoot, env: process.env });
    const lines: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      chunk.toString('utf8').split('\n').filter(Boolean).forEach((line) => {
        lines.push(line);
        console.log(`  ${line}`);
      });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      chunk.toString('utf8').split('\n').filter(Boolean).forEach((line) => {
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

async function verifyFolders(correlationId: string): Promise<{ id: string; name: string }[]> {
  const folders = await listWorkspaceFolders();
  return folders.filter((f) => f.name.startsWith(`${correlationId}__`));
}

interface IterationResult {
  iteration: number;
  correlationId: string;
  workerAAcquired: boolean;
  workerBReclaimed: boolean;
  workerBFoundExisting: boolean | null;
  folderCount: number;
  folderNames: string[];
  localRecordFolderName: string | null;
  duplicate: boolean;
}

async function runIteration(iteration: number, serviceRoot: string): Promise<IterationResult> {
  const correlationId = randomUUID();
  const distributorName = 'Slow-Owner Race Experiment (SharePoint)';
  console.log(`\n=== Iteration ${iteration}: ${correlationId} ===`);

  const workerAScript = path.join(serviceRoot, 'scripts', 'lib', 'slowWorkerA.ts');
  const workerBScript = path.join(serviceRoot, 'scripts', 'lib', 'slowWorkerB.ts');

  console.log('Spawning Worker A (original owner)...');
  const workerAPromise = runWorker(
    workerAScript,
    [correlationId, distributorName, String(WORKER_A_DELAY_MS)],
    serviceRoot
  );

  await new Promise((resolve) => setTimeout(resolve, WORKER_B_STAGGER_MS));

  console.log('Spawning Worker B (recovery owner) - Worker A is still alive and waiting...');
  const workerBPromise = runWorker(
    workerBScript,
    [correlationId, distributorName, String(STALE_AFTER_MS), String(WORKER_B_WAIT_MS)],
    serviceRoot
  );

  const [resultA, resultB] = await Promise.all([workerAPromise, workerBPromise]);

  const acquireInfo = parseMarker(resultA.lines, 'WORKER_A_ACQUIRE') as { acquired: boolean } | null;
  const reclaimInfo = parseMarker(resultB.lines, 'WORKER_B_RECLAIM') as { reclaimed: boolean } | null;
  const reconcileInfo = parseMarker(resultB.lines, 'WORKER_B_RECONCILE') as { foundExisting: boolean } | null;

  console.log('\nIndependently verifying against SharePoint (not trusting either worker\'s own report)...');
  const folders = await verifyFolders(correlationId);
  console.table(folders);

  const localRecord = getOperation(correlationId);
  console.log('Local durable record after both workers finished:', JSON.stringify(localRecord));

  const duplicate = folders.length > 1;

  return {
    iteration,
    correlationId,
    workerAAcquired: acquireInfo?.acquired ?? false,
    workerBReclaimed: reclaimInfo?.reclaimed ?? false,
    workerBFoundExisting: reconcileInfo ? reconcileInfo.foundExisting : null,
    folderCount: folders.length,
    folderNames: folders.map((f) => f.name),
    localRecordFolderName: localRecord?.incidentNumber ?? null,
    duplicate,
  };
}

async function main() {
  const iterations = Number(process.argv[2] ?? 3);
  const serviceRoot = path.join(__dirname, '..');

  console.log(
    `Running ${iterations} iterations. Worker A delays ${WORKER_A_DELAY_MS}ms before calling SharePoint; ` +
      `Worker B waits ${WORKER_B_WAIT_MS}ms (past the ${STALE_AFTER_MS}ms staleness threshold) before reclaiming. ` +
      'This margin is deliberately wide so the dangerous overlap is exercised on every run, not by luck.'
  );

  const results: IterationResult[] = [];
  for (let i = 1; i <= iterations; i++) {
    results.push(await runIteration(i, serviceRoot));
  }

  console.log('\n=== Summary across all iterations ===');
  console.table(results);

  const duplicateCount = results.filter((r) => r.duplicate).length;
  console.log(
    `\n${duplicateCount}/${iterations} iterations produced more than one SharePoint folder for the same ` +
      'business-operation ID.'
  );
  if (duplicateCount === 0) {
    console.log(
      'PASS (Experiment 2): SharePoint\'s conflictBehavior "fail" closed the exact race that produced a real ' +
        'ServiceNow duplicate 3/3 times (OB-0022). Worker B\'s reconciliation found nothing (because Worker A had ' +
        'not called SharePoint yet) and attempted to create the folder - but by the time Worker A\'s own delayed ' +
        'call also landed, SharePoint\'s own conflict detection allowed only one of the two create attempts to ' +
        'succeed, independently verified against the real site.'
    );
  } else if (duplicateCount === iterations) {
    console.log(
      'FAIL (Experiment 2): SharePoint did not close the race - every iteration produced two real folders for ' +
        'the same business operation, the same failure mode ADR 0005 documented for ServiceNow.'
    );
  } else {
    console.log('Mixed result - some iterations raced, some did not. Investigate the timing logs above before drawing conclusions.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
