import { replayRange } from '../src/salesforce/pubsubClient';
import { config } from '../src/config';
import { authenticate } from '../src/servicenow/auth';

/**
 * Investigates whether a "silently lost" event (LL-0009: checkpoint
 * persisted but ServiceNow never called) can be detected after the fact.
 *
 * Replays Salesforce events, then checks each one's correlationId
 * against ServiceNow. Read-only: does not touch the runtime checkpoint,
 * does not call ServiceNow's write API, does not fix anything.
 *
 * Usage:
 *   npm run detect-unprocessed-events                         # full sweep from EARLIEST
 *   npm run detect-unprocessed-events -- <fromReplayIdBase64>  # from a known-good position
 *
 * With no argument, sweeps everything Salesforce has retained for this
 * topic (confirmed viable - see docs/devex/friction-log.md FL-0017).
 * With an argument, that replay ID must be a position you already know
 * precedes the suspected gap - this script does not find that position
 * on its own, since the current checkpoint mechanism retains no history
 * (see FL-0017).
 */
async function incidentExistsForCorrelationId(correlationId: string): Promise<boolean> {
  const { accessToken } = await authenticate();
  const query = new URLSearchParams({
    sysparm_query: `correlation_id=${correlationId}`,
    sysparm_limit: '1',
  });
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { result?: unknown[] };
  if (!response.ok) {
    throw new Error(`ServiceNow query failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return Array.isArray(body.result) && body.result.length > 0;
}

async function main() {
  const from = process.argv[2] ?? 'EARLIEST';

  console.log(
    `Replaying events from ${from === 'EARLIEST' ? 'EARLIEST (full sweep)' : `replayId=${from}`} ` +
      '(read-only - no checkpoint or ServiceNow writes)...'
  );
  const events = await replayRange(config.salesforce.pubsubTopic, from);
  console.log(`Collected ${events.length} event(s) from Salesforce.\n`);

  for (const event of events) {
    const correlationId = event.payload.Correlation_Id__c as string | undefined;
    const distributorName = event.payload.Distributor_Name__c as string | undefined;

    if (!correlationId) {
      console.log(`SKIPPED - event has no Correlation_Id__c: ${JSON.stringify(event.payload)}`);
      continue;
    }

    const exists = await incidentExistsForCorrelationId(correlationId);
    console.log(
      `${exists ? 'OK          ' : 'GAP DETECTED'} - correlationId=${correlationId} ` +
        `distributor="${distributorName}" replayId=${event.replayId.toString('base64')}`
    );
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
