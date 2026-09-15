import { authenticate } from '../src/servicenow/auth';
import { config } from '../src/config';

/**
 * Lists the most recently created ServiceNow Incidents, so a test run can
 * be confirmed without opening the ServiceNow UI. Pass a correlation ID
 * (printed by publish-test-event.ts) to filter to one specific event;
 * otherwise shows the N most recent.
 *
 * Closes the manual-verification gap noted in
 * docs/devex/lessons-learned.md LL-0004.
 */
async function main() {
  const arg = process.argv[2];
  const isCorrelationId = arg && arg.includes('-'); // crude UUID check vs. a limit number
  const limit = isCorrelationId ? '10' : arg ?? '5';

  const { accessToken } = await authenticate();

  const query = new URLSearchParams({
    sysparm_query: isCorrelationId
      ? `correlation_id=${arg}^ORDERBYDESCsys_created_on`
      : 'ORDERBYDESCsys_created_on',
    sysparm_limit: limit,
    sysparm_fields: 'number,short_description,correlation_id,sys_created_on,sys_created_by',
    sysparm_display_value: 'true',
  });

  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const body = (await response.json()) as { result?: Record<string, unknown>[] };

  if (!response.ok) {
    throw new Error(`ServiceNow query failed (${response.status}): ${JSON.stringify(body)}`);
  }

  if (!body.result || body.result.length === 0) {
    console.log('No matching incidents found.');
    return;
  }

  console.table(body.result);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
