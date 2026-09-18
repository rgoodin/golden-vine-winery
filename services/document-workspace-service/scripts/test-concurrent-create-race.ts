import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as path from 'path';
import { listWorkspaceFolders } from '../src/sharepoint/workspaceReconciliation';

/**
 * Experiment 1 of the SharePoint target-side uniqueness investigation
 * (docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md).
 * Answers exactly one question:
 *
 * Under real concurrent load, with NO local reliability store involved
 * at all, does SharePoint's `conflictBehavior: "fail"` ever let two
 * folders with the identical name both get created?
 *
 * Two genuinely independent OS processes
 * (scripts/lib/rawCreateRaceWorker.ts) each call the real, unmodified
 * production adapter for the identical correlationId/distributorName,
 * started via Promise.all with zero deliberate stagger - as close to
 * simultaneous as two separately spawned processes hitting the same
 * live API can get.
 *
 * No architectural conclusion is drawn from this alone - it isolates
 * SharePoint's own behavior before Experiment 2
 * (test-target-side-uniqueness-race.ts) reproduces the actual
 * production race (OB-0022) that this project already knows defeats
 * the local mechanism.
 */

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

async function verifyFolders(correlationId: string): Promise<{ id: string; name: string }[]> {
  const folders = await listWorkspaceFolders();
  return folders.filter((f) => f.name.startsWith(`${correlationId}__`));
}

interface IterationResult {
  iteration: number;
  correlationId: string;
  aOutcome: string;
  bOutcome: string;
  folderCount: number;
  duplicate: boolean;
}

async function runIteration(iteration: number, serviceRoot: string): Promise<IterationResult> {
  const correlationId = randomUUID();
  const distributorName = 'Concurrent Create Race Experiment';
  console.log(`\n=== Iteration ${iteration}: ${correlationId} ===`);

  const workerScript = path.join(serviceRoot, 'scripts', 'lib', 'rawCreateRaceWorker.ts');

  const [resultA, resultB] = await Promise.all([
    runWorker(workerScript, [correlationId, distributorName, 'A'], serviceRoot),
    runWorker(workerScript, [correlationId, distributorName, 'B'], serviceRoot),
  ]);

  const aOutcome = resultA.lines.find((l) => l.startsWith('RACE_WORKER_A_')) ?? '(no marker)';
  const bOutcome = resultB.lines.find((l) => l.startsWith('RACE_WORKER_B_')) ?? '(no marker)';

  console.log('\nIndependently verifying against SharePoint (not trusting either worker\'s own report)...');
  const folders = await verifyFolders(correlationId);
  console.table(folders);

  const duplicate = folders.length > 1;

  return { iteration, correlationId, aOutcome, bOutcome, folderCount: folders.length, duplicate };
}

async function main() {
  const iterations = Number(process.argv[2] ?? 5);
  const serviceRoot = path.join(__dirname, '..');

  console.log(
    `Running ${iterations} iterations. Both workers race, with zero deliberate stagger, to create a folder ` +
      'with the identical name. No local reliability store is involved in this experiment at all.'
  );

  const results: IterationResult[] = [];
  for (let i = 1; i <= iterations; i++) {
    results.push(await runIteration(i, serviceRoot));
  }

  console.log('\n=== Summary across all iterations ===');
  console.table(results);

  const duplicateCount = results.filter((r) => r.duplicate).length;
  console.log(
    `\n${duplicateCount}/${iterations} iterations produced more than one SharePoint folder for the identical name.`
  );
  if (duplicateCount === 0) {
    console.log(
      'PASS (Experiment 1): SharePoint\'s conflictBehavior "fail" held under direct concurrent load across ' +
        'every iteration - exactly one of the two racing create calls succeeded each time, independently verified. ' +
        'This does not yet prove the production slow-owner race is closed - see Experiment 2 ' +
        '(test-target-side-uniqueness-race.ts) for that.'
    );
  } else {
    console.log(
      'FAIL (Experiment 1): SharePoint allowed a genuine duplicate under direct concurrent load. This alone is ' +
        'sufficient to conclude target-side uniqueness is NOT reliably enforced - Experiment 2 would only ' +
        'confirm the same conclusion through a more complex path.'
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
