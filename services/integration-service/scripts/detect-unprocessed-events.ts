import { replayRange } from '../src/salesforce/pubsubClient';
import { config } from '../src/config';
import { authenticate } from '../src/servicenow/auth';

/**
 * Audit/experimental instrument (Phase 3 - not promoted to the Golden
 * Path). Investigates two confirmed failure modes after the fact -
 * silent loss (LL-0009) and duplicate processing (LL-0005/LL-0008) - by
 * replaying Salesforce events and counting matching ServiceNow Incidents
 * per correlation ID, rather than only checking existence.
 *
 * Read-only: does not touch the runtime checkpoint, does not call
 * ServiceNow's write API, does not modify subscriber processing,
 * checkpoint behavior, replay behavior, idempotency, or retries. This
 * only classifies what already happened - see
 * docs/devex/lessons-learned.md LL-0010/LL-0011.
 *
 * Usage:
 *   npm run detect-unprocessed-events                         # full sweep from EARLIEST
 *   npm run detect-unprocessed-events -- <fromReplayIdBase64>  # from a known-good position
 *
 * With no argument, sweeps everything Salesforce has retained for this
 * topic (confirmed viable - see docs/devex/friction-log.md FL-0017).
 * With an argument, that replay ID must be a position you already know
 * precedes the region of interest - this script does not find that
 * position on its own, since the current checkpoint mechanism retains no
 * history (see FL-0017).
 *
 * Classification per event with a usable correlationId:
 *   0 matching Incidents -> GAP
 *   1 matching Incident  -> OK
 *   >1 matching Incidents -> DUPLICATE (reports Incident numbers as evidence)
 *
 * Events with no Correlation_Id__c (predating that field's existence -
 * see docs/decisions/0003-platform-event-schema.md) are reported as
 * UNEVALUABLE, a distinct category from GAP - the absence of a
 * side effect can't be established for something that predates the
 * mechanism used to look it up.
 */
interface IncidentMatch {
  number: string;
  sys_id: string;
}

async function findIncidentsForCorrelationId(correlationId: string): Promise<IncidentMatch[]> {
  const { accessToken } = await authenticate();
  const query = new URLSearchParams({
    sysparm_query: `correlation_id=${correlationId}`,
    sysparm_fields: 'number,sys_id',
    sysparm_limit: '50',
  });
  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { result?: IncidentMatch[] };
  if (!response.ok) {
    throw new Error(`ServiceNow query failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.result ?? [];
}

type Classification = 'UNEVALUABLE' | 'GAP' | 'OK' | 'DUPLICATE';

async function main() {
  const from = process.argv[2] ?? 'EARLIEST';

  console.log(
    `Replaying events from ${from === 'EARLIEST' ? 'EARLIEST (full sweep)' : `replayId=${from}`} ` +
      '(read-only - no checkpoint or ServiceNow writes)...'
  );
  const events = await replayRange(config.salesforce.pubsubTopic, from);
  console.log(`Collected ${events.length} event(s) from Salesforce.\n`);

  const tally: Record<Classification, number> = { UNEVALUABLE: 0, GAP: 0, OK: 0, DUPLICATE: 0 };

  for (const event of events) {
    const correlationId = event.payload.Correlation_Id__c as string | undefined;
    const distributorName = event.payload.Distributor_Name__c as string | undefined;
    const replayId = event.replayId.toString('base64');

    if (!correlationId) {
      tally.UNEVALUABLE++;
      console.log(
        `UNEVALUABLE  - no Correlation_Id__c (predates required schema) - ` +
          `replayId=${replayId} payload=${JSON.stringify(event.payload)}`
      );
      continue;
    }

    const incidents = await findIncidentsForCorrelationId(correlationId);
    const classification: Classification =
      incidents.length === 0 ? 'GAP' : incidents.length === 1 ? 'OK' : 'DUPLICATE';
    tally[classification]++;

    const evidence =
      incidents.length > 0
        ? ` incidents=[${incidents.map((i) => i.number).join(', ')}] count=${incidents.length}`
        : '';
    console.log(
      `${classification.padEnd(12)} - correlationId=${correlationId} ` +
        `distributor="${distributorName}" replayId=${replayId}${evidence}`
    );
  }

  console.log(
    `\nSummary: ${events.length} event(s) - ` +
      `UNEVALUABLE=${tally.UNEVALUABLE} GAP=${tally.GAP} OK=${tally.OK} DUPLICATE=${tally.DUPLICATE}`
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
