import { randomUUID } from 'crypto';
import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';

/**
 * Controlled concurrency experiment for the ServiceNow target-side
 * idempotency investigation (docs/architecture/0001-reliability-architecture-spike.md).
 *
 * Deliberately does NOT do request -> lookup -> create. That sequential
 * pattern only proves our own code can query before writing; it says
 * nothing about whether ServiceNow itself can enforce the invariant when
 * two requests for the same business operation arrive close together.
 * Instead this fires both create requests via Promise.all so they are in
 * flight concurrently, then independently re-queries ServiceNow afterward
 * to see what the platform actually allowed.
 *
 * Uses the existing itil-role OAuth credentials from .env (ADR 0004) -
 * this script does not require or use elevated privileges.
 */
async function createIncident(accessToken: string, businessOperationId: string) {
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      short_description: `Concurrency experiment: ${businessOperationId}`,
      u_gv_business_operation_id: businessOperationId,
    }),
  });

  const body = (await response.json()) as {
    result?: { sys_id: string; number: string };
    error?: { message: string; detail: string };
  };

  return { status: response.status, ok: response.ok, body };
}

async function main() {
  const businessOperationId = randomUUID();
  console.log(`Business operation ID under test: ${businessOperationId}`);

  const { accessToken } = await authenticate();

  console.log('Firing two concurrent create requests via Promise.all...');
  const [resultA, resultB] = await Promise.all([
    createIncident(accessToken, businessOperationId),
    createIncident(accessToken, businessOperationId),
  ]);

  console.log('\n--- What each caller received ---');
  console.log('Request A:', JSON.stringify(resultA, null, 2));
  console.log('Request B:', JSON.stringify(resultB, null, 2));

  console.log('\n--- Independently querying ServiceNow afterward ---');
  const query = new URLSearchParams({
    sysparm_query: `u_gv_business_operation_id=${businessOperationId}`,
    sysparm_fields: 'number,sys_id,u_gv_business_operation_id,sys_created_on',
    sysparm_display_value: 'true',
  });

  const verifyResponse = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const verifyBody = (await verifyResponse.json()) as { result?: Record<string, unknown>[] };

  const incidents = verifyBody.result ?? [];
  console.log(`\nIncidents found for this business operation ID: ${incidents.length}`);
  if (incidents.length > 0) {
    console.table(incidents);
  }

  console.log('\n--- Result classification ---');
  if (incidents.length === 0) {
    console.log('ZERO Incidents created - unexpected; both requests may have failed.');
  } else if (incidents.length === 1) {
    console.log(
      'EXACTLY ONE Incident created despite two concurrent create requests. ' +
        'This alone does not prove a platform-enforced uniqueness boundary - ' +
        'confirm by checking whether the losing request received a real ' +
        'rejection (e.g. a constraint-violation error) rather than also ' +
        'silently succeeding against a record it did not create.'
    );
  } else {
    console.log(
      `${incidents.length} Incidents created for the SAME business operation ID. ` +
        'This demonstrates ServiceNow did NOT enforce uniqueness under ' +
        'concurrent requests for this field/configuration.'
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
