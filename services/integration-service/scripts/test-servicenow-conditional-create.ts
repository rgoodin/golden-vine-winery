import { randomUUID } from 'crypto';
import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';

/**
 * Investigation-only probe, direct follow-up to OB-0022: does ServiceNow's
 * Table API (or the REST surface generally) provide any target-enforced
 * conditional-write mechanism on record CREATION - not update - that
 * could reject a stale writer's create atomically, inside ServiceNow's
 * own transaction, rather than via a client-side check?
 *
 * Deliberately does NOT test:
 * - GET-then-POST (already rejected by OB-0014 - a client-side race,
 *   not a target-enforced one)
 * - a local fencing-token check before POST (already rejected by
 *   OB-0022 - narrows the window, doesn't close it)
 *
 * This only probes whether ServiceNow's own HTTP layer recognizes and
 * enforces standard conditional-request semantics (ETag / If-Match /
 * If-None-Match) on writes, and whether PUT can create a not-yet-existing
 * record at all (a prerequisite for any "create via PUT + If-None-Match"
 * upsert pattern). No workaround is implemented - only observed.
 */

async function main() {
  const { accessToken } = await authenticate();
  const headers = { Authorization: `Bearer ${accessToken}` };

  console.log('=== Probe 1: does a normal GET response include ETag/Last-Modified headers at all? ===');
  const listResponse = await fetch(
    `${config.serviceNow.instanceUrl}/api/now/table/incident?sysparm_limit=1`,
    { headers }
  );
  const relevantListHeaders = ['etag', 'last-modified', 'cache-control'];
  console.log('Status:', listResponse.status);
  for (const h of relevantListHeaders) {
    console.log(`  ${h}: ${listResponse.headers.get(h) ?? '(absent)'}`);
  }
  const listBody = (await listResponse.json()) as { result?: { sys_id: string }[] };
  const sampleSysId = listBody.result?.[0]?.sys_id;

  if (sampleSysId) {
    console.log(`\n=== Probe 2: does GET on a specific record (${sampleSysId}) include ETag? ===`);
    const singleResponse = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident/${sampleSysId}`, {
      headers,
    });
    console.log('Status:', singleResponse.status);
    for (const h of relevantListHeaders) {
      console.log(`  ${h}: ${singleResponse.headers.get(h) ?? '(absent)'}`);
    }
  }

  console.log('\n=== Probe 3: does POST (create) honor If-None-Match: * (does ServiceNow reject the header, ignore it, or enforce it)? ===');
  const businessOperationId1 = randomUUID();
  const postResponse = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'If-None-Match': '*',
    },
    body: JSON.stringify({
      short_description: `Conditional-create probe (If-None-Match on POST): ${businessOperationId1}`,
      u_gv_business_operation_id: businessOperationId1,
    }),
  });
  const postBody = (await postResponse.json()) as { result?: { sys_id: string; number: string } };
  console.log('Status:', postResponse.status);
  console.log('Result:', postResponse.ok ? `created ${postBody.result?.number}` : JSON.stringify(postBody));
  console.log(
    postResponse.ok
      ? 'ServiceNow accepted the create despite If-None-Match: * - the header had no observable effect (either silently ignored, or not recognized as a precondition on this operation).'
      : 'ServiceNow rejected the create - investigate why (could be the conditional header, or an unrelated validation error).'
  );

  console.log('\n=== Probe 4: sending TWO concurrent creates for the SAME business-operation ID, both with If-None-Match: * ===');
  const businessOperationId2 = randomUUID();
  const createWithPrecondition = () =>
    fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'If-None-Match': '*',
      },
      body: JSON.stringify({
        short_description: `Conditional-create probe (concurrent, If-None-Match): ${businessOperationId2}`,
        u_gv_business_operation_id: businessOperationId2,
      }),
    });
  const [respA, respB] = await Promise.all([createWithPrecondition(), createWithPrecondition()]);
  const [bodyA, bodyB] = await Promise.all([respA.json(), respB.json()]) as [
    { result?: { sys_id: string; number: string } },
    { result?: { sys_id: string; number: string } }
  ];
  console.log(`Request A: status ${respA.status}, ${respA.ok ? bodyA.result?.number : JSON.stringify(bodyA)}`);
  console.log(`Request B: status ${respB.status}, ${respB.ok ? bodyB.result?.number : JSON.stringify(bodyB)}`);

  const verifyQuery = new URLSearchParams({
    sysparm_query: `u_gv_business_operation_id=${businessOperationId2}`,
    sysparm_fields: 'number,sys_id',
  });
  const verifyResponse = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${verifyQuery}`, {
    headers,
  });
  const verifyBody = (await verifyResponse.json()) as { result?: { number: string; sys_id: string }[] };
  const incidents = verifyBody.result ?? [];
  console.log(`Independently verified Incident count for this business-operation ID: ${incidents.length}`);
  console.table(incidents);

  console.log('\n=== Probe 5: can PUT create a not-yet-existing record (a prerequisite for any PUT + If-None-Match upsert pattern)? ===');
  const neverUsedSysId = randomUUID().replace(/-/g, '');
  const putResponse = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident/${neverUsedSysId}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'If-None-Match': '*',
    },
    body: JSON.stringify({
      short_description: `Conditional-create probe (PUT to nonexistent sys_id)`,
    }),
  });
  const putBody = await putResponse.json();
  console.log('Status:', putResponse.status);
  console.log('Body:', JSON.stringify(putBody));
  console.log(
    putResponse.status === 404
      ? 'PUT to a nonexistent sys_id returned 404 - PUT is update-only, not upsert-capable. No "create via PUT" path exists to attach a conditional header to.'
      : putResponse.ok
        ? 'UNEXPECTED: PUT created a record at a client-chosen sys_id - this would need further investigation as a possible upsert path.'
        : 'Unexpected response - investigate.'
  );

  console.log('\n=== Conclusion ===');
  console.log(
    'This probe checked whether ServiceNow\'s Table API recognizes standard HTTP conditional-request ' +
      'semantics (ETag / If-Match / If-None-Match) on record creation, independent of official documentation. ' +
      'See docs/architecture/0001-reliability-architecture-spike.md for the full analysis combining this ' +
      "with ServiceNow's own official Table API reference documentation."
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
