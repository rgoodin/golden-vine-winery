import { randomUUID } from 'crypto';
import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';
import { openStore, acquire, markCompleted, getRecord } from './lib/idempotencyStore';

/**
 * Investigation-only prototype: does an integration-owned durable
 * idempotency store (Candidate C, docs/architecture/0001-reliability-architecture-spike.md)
 * establish "one business-operation ID -> at most one ServiceNow Incident"
 * under genuine concurrency, the same adversarial shape used against
 * ServiceNow itself in scripts/test-servicenow-concurrent-idempotency.ts?
 *
 * Unlike that script, the atomic gate here happens BEFORE either caller
 * ever calls ServiceNow: each attempt first tries to atomically acquire
 * ownership of the business-operation ID in a local SQLite store (a real
 * PRIMARY KEY constraint, not a prior SELECT - see scripts/lib/idempotencyStore.ts).
 * Only the winner calls ServiceNow at all. The loser is expected to never
 * make an HTTP call.
 *
 * Repeats N times with a fresh business-operation ID each time, because a
 * single run proves nothing about whether a result was accidental.
 */

interface AttemptResult {
  label: string;
  acquired: boolean;
  calledServiceNow: boolean;
  incident?: { sysId: string; number: string };
  serviceNowError?: string;
}

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
      short_description: `Durable-state concurrency experiment: ${businessOperationId}`,
      u_gv_business_operation_id: businessOperationId,
    }),
  });

  const body = (await response.json()) as {
    result?: { sys_id: string; number: string };
    error?: { message: string; detail: string };
  };

  if (!response.ok) {
    throw new Error(`ServiceNow Incident creation failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return { sysId: body.result!.sys_id, number: body.result!.number };
}

async function attempt(
  db: ReturnType<typeof openStore>,
  accessToken: string,
  businessOperationId: string,
  label: string
): Promise<AttemptResult> {
  const acquired = acquire(db, businessOperationId);
  if (!acquired) {
    return { label, acquired: false, calledServiceNow: false };
  }

  try {
    const incident = await createIncident(accessToken, businessOperationId);
    markCompleted(db, businessOperationId, incident.sysId, incident.number);
    return { label, acquired: true, calledServiceNow: true, incident };
  } catch (err) {
    return { label, acquired: true, calledServiceNow: true, serviceNowError: (err as Error).message };
  }
}

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

interface IterationSummary {
  iteration: number;
  businessOperationId: string;
  winner: string | null;
  loserCalledServiceNow: boolean;
  incidentCount: number;
  finalStoreStatus: string | null;
  clean: boolean;
}

async function main() {
  const iterations = Number(process.argv[2] ?? 5);
  const db = openStore();
  const { accessToken } = await authenticate();

  console.log(`Running ${iterations} iterations of two-concurrent-attempts-per-business-operation-ID...\n`);

  const summaries: IterationSummary[] = [];

  for (let i = 1; i <= iterations; i++) {
    const businessOperationId = randomUUID();
    console.log(`--- Iteration ${i}: ${businessOperationId} ---`);

    const [resultA, resultB] = await Promise.all([
      attempt(db, accessToken, businessOperationId, 'A'),
      attempt(db, accessToken, businessOperationId, 'B'),
    ]);

    console.log('  A:', JSON.stringify(resultA));
    console.log('  B:', JSON.stringify(resultB));

    const incidentCount = await verifyIncidentCount(accessToken, businessOperationId);
    const record = getRecord(db, businessOperationId);

    const winner = resultA.acquired ? 'A' : resultB.acquired ? 'B' : null;
    const loser = winner === 'A' ? resultB : winner === 'B' ? resultA : null;
    const loserCalledServiceNow = loser?.calledServiceNow ?? false;
    const clean = winner !== null && !loserCalledServiceNow && incidentCount === 1;

    console.log(`  Independently verified Incident count: ${incidentCount}`);
    console.log(`  Durable-state record: ${JSON.stringify(record)}`);
    console.log(`  Clean single-winner outcome: ${clean}\n`);

    summaries.push({
      iteration: i,
      businessOperationId,
      winner,
      loserCalledServiceNow,
      incidentCount,
      finalStoreStatus: record?.status ?? null,
      clean,
    });
  }

  console.log('--- Summary across all iterations ---');
  console.table(summaries);

  const cleanCount = summaries.filter((s) => s.clean).length;
  console.log(`\n${cleanCount}/${iterations} iterations produced exactly one winner, exactly one Incident, and confirmed the loser never called ServiceNow.`);
  if (cleanCount === iterations) {
    console.log(
      'The atomic create-if-absent gate held on every iteration. This is a genuinely different ' +
        'result from ServiceNow itself (OB-0014): here the losing caller never reaches the ' +
        'external system at all, rather than reaching it and being incorrectly accepted.'
    );
  } else {
    console.log('At least one iteration did NOT produce a clean single-winner outcome - investigate before treating this as reliable.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
