import { config } from '../config';
import { authenticate } from './auth';

/**
 * The ServiceNow-specific half of reconciliation (OB-0021): given a
 * business-operation ID, ask ServiceNow directly whether an Incident for
 * it already exists, rather than trusting local state alone. Queries the
 * same standard `correlation_id` field `incidentAdapter.ts` already
 * writes on create - not the experimental-only `u_gv_business_operation_id`
 * custom field the earlier prototype used (`scripts/test-durable-state-reclaim-reconciliation.ts`),
 * which was never a production field.
 *
 * Deliberately lives in `src/servicenow/`, not `src/reliability/` - the
 * generic idempotency store has no business knowing what an Incident is
 * or which field identifies one. A second target's reconciliation would
 * be its own module here, not a branch inside this one.
 */
export async function findIncidentByCorrelationId(
  correlationId: string
): Promise<{ sysId: string; number: string } | null> {
  const { accessToken } = await authenticate();

  const query = new URLSearchParams({
    sysparm_query: `correlation_id=${correlationId}`,
    sysparm_fields: 'number,sys_id',
  });
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const body = (await response.json()) as { result?: { sys_id: string; number: string }[] };
  if (!response.ok) {
    throw new Error(`ServiceNow Incident lookup failed (${response.status}): ${JSON.stringify(body)}`);
  }

  const [incident] = body.result ?? [];
  return incident ? { sysId: incident.sys_id, number: incident.number } : null;
}
