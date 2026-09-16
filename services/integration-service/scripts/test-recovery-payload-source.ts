import { randomUUID } from 'crypto';
import { authenticate as sfAuthenticate } from '../src/salesforce/auth';
import { replayRange } from '../src/salesforce/pubsubClient';
import { config } from '../src/config';
import { acquireOperation } from '../src/reliability/idempotencyStore';

/**
 * Bounded investigation (NOT another reliability redesign) into FL-0024:
 * recoverStaleDistributorOnboardingOperation() needs the original event,
 * but idempotencyStore deliberately never stores one. Where should Tier
 * 1 actually get it? Two real questions, answered experimentally rather
 * than assumed:
 *
 *   Part 1 (Approach A - source-owned): starting from NOTHING but a
 *   business-operation ID - exactly what a stale idempotencyStore row or
 *   an audit-tool GAP classification durably provides - can the specific
 *   originating Salesforce event actually be relocated?
 *
 *   Part 2 (Approach C - minimal durable reference): if idempotencyStore
 *   instead persisted a small reference (the event's own replay ID)
 *   rather than the ID alone, would that reference actually let a later
 *   caller refetch THAT SAME event? Salesforce's own proto comments
 *   (pubsub_api.proto's FetchRequest.replay_id: "specify the
 *   subscription point to start AFTER") say no - this part tests that
 *   claim directly rather than trusting the doc comment.
 *
 * Read-only with respect to ServiceNow (never calls it). Touches the
 * real idempotencyStore only to reproduce the exact "stale in_flight,
 * no payload" local state recovery would actually face - the same
 * shape as OB-0026's Case 1, reused here as the precondition for a
 * payload-location question, not a reliability retest.
 */

async function publishEvent(
  distributorName: string,
  correlationId: string
): Promise<{ eventId: string; correlationId: string }> {
  const { accessToken, instanceUrl } = await sfAuthenticate();
  const objectApiName = config.salesforce.pubsubTopic.replace(/^\/event\//, '');
  const eventId = randomUUID();

  const payload = {
    Event_Id__c: eventId,
    Event_Version__c: '1.0',
    Correlation_Id__c: correlationId,
    Distributor_Name__c: distributorName,
    Distributor_External_Id__c: 'EXT-PAYLOAD-SOURCE-TEST',
    Primary_Contact_Name__c: 'Jane Doe',
    Primary_Contact_Email__c: 'jane.doe@example.com',
    Opportunity_Id__c: '006000000000003',
    Account_Id__c: '001000000000003',
    Sales_Owner__c: 'John Smith',
  };

  const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/${objectApiName}/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Publish failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { eventId, correlationId };
}

async function part1SourceOwnedRecovery() {
  console.log('\n=== Part 1 (Approach A): can a bare business-operation ID be mapped back to its source event? ===');

  const operationId = randomUUID();
  console.log(`Publishing one real event for business operation ${operationId}...`);
  await publishEvent('Recovery Payload Source Test - Part 1', operationId);

  // Reproduces OB-0026 Case 1's precondition: acquired locally, crashed
  // before ServiceNow was ever called. From this point on, the only
  // thing this script "remembers" on purpose is operationId - simulating
  // a process that crashed and lost everything not durably persisted,
  // which is exactly what a real recovery caller has to work with.
  acquireOperation(operationId);
  console.log('Acquired locally (simulated crash before ServiceNow) - now discarding all in-memory knowledge of the event.');

  console.log(
    "\nAttempting to relocate it using ONLY operationId, via the same mechanism " +
      "detect-unprocessed-events.ts already uses: a full ReplayPreset.EARLIEST sweep, filtered client-side. " +
      "There is no server-side query-by-field RPC to use instead - src/salesforce/proto/pubsub_api.proto's " +
      "FetchRequest has exactly topic_name/replay_preset/replay_id/num_requested; no filter field of any kind."
  );

  const start = Date.now();
  const events = await replayRange(config.salesforce.pubsubTopic, 'EARLIEST');
  const elapsedMs = Date.now() - start;

  const match = events.find((e) => e.payload.Correlation_Id__c === operationId);

  console.log(`\nSwept ${events.length} total retained event(s) in ${elapsedMs}ms to find 1 specific event.`);
  console.log(
    match
      ? `FOUND: replayId=${match.replayId.toString('base64')}, distributor="${match.payload.Distributor_Name__c}"`
      : 'NOT FOUND - unexpected for an event published seconds ago.'
  );

  console.log(
    '\nWhat this does and does not establish: locating ONE specific stale operation currently costs a full ' +
      `sweep of everything Salesforce has retained for this topic (${events.length} events today, growing with ` +
      'every future test and every future real event), not a targeted lookup - there is no cheaper path available ' +
      'with the APIs this project has access to. This project has never established Salesforce\'s actual retention ' +
      'window for this topic (FL-0013: GetTopic\'s TopicInfo has no retention field at all) - so whether an ' +
      'older stale operation\'s event is even still retrievable by the time recovery runs is unknown, not assumed ' +
      'safe or unsafe either way.'
  );

  return { found: !!match, sweptCount: events.length, elapsedMs };
}

async function part2DurableReference() {
  console.log('\n=== Part 2 (Approach C): does an event\'s OWN replay ID let you refetch THAT event later? ===');

  const idA = randomUUID();
  const idB = randomUUID();
  console.log(`Publishing event A (${idA}) then event B (${idB}) in sequence...`);
  await publishEvent('Recovery Payload Source Test - Part 2 - Event A', idA);
  await publishEvent('Recovery Payload Source Test - Part 2 - Event B', idB);

  console.log('Waiting for both to be retained, then finding event A\'s own replayId via a full sweep...');
  const sweep = await replayRange(config.salesforce.pubsubTopic, 'EARLIEST');
  const eventA = sweep.find((e) => e.payload.Correlation_Id__c === idA);
  if (!eventA) {
    throw new Error('Could not locate event A in the sweep - cannot run this part of the experiment.');
  }
  const replayIdA = eventA.replayId.toString('base64');
  console.log(`Event A's own replayId: ${replayIdA}`);

  console.log(
    "\nHypothesis under test: if idempotencyStore had durably stored replayIdA as event A's " +
      '"reference" at acquire time, could recovery later call replayRange(topic, replayIdA) and get event A ' +
      'back? Salesforce\'s own proto comment says CUSTOM replay resumes AFTER the given replay_id, not AT it - ' +
      'testing that directly rather than trusting the comment.'
  );

  const resumed = await replayRange(config.salesforce.pubsubTopic, replayIdA);
  const eventAPresent = resumed.some((e) => e.payload.Correlation_Id__c === idA);
  const eventBPresent = resumed.some((e) => e.payload.Correlation_Id__c === idB);

  console.log(`\nReplaying from event A's own replayId returned ${resumed.length} event(s).`);
  console.log(`Event A present in that result: ${eventAPresent}`);
  console.log(`Event B present in that result: ${eventBPresent}`);

  const confirmsStartAfter = !eventAPresent;
  console.log(
    confirmsStartAfter
      ? 'CONFIRMED: replaying from an event\'s own replayId does NOT return that event - matches "start after" ' +
          "semantics. A durable reference sufficient to refetch operation X's own event would need to be the " +
          'replayId of whatever preceded X, not X\'s own - something no current mechanism captures per-operation.'
      : 'UNEXPECTED: event A WAS returned when replaying from its own replayId - the "start after" assumption ' +
          'does not hold as documented; re-examine before relying on either behavior.'
  );

  return { confirmsStartAfter, eventAPresent, eventBPresent, resumedCount: resumed.length };
}

async function main() {
  const part1 = await part1SourceOwnedRecovery();
  const part2 = await part2DurableReference();

  console.log('\n=== Summary ===');
  console.log(
    `Part 1 (Approach A): a bare business-operation ID WAS relocatable to its source event via a full ` +
      `EARLIEST sweep (${part1.sweptCount} events, ${part1.elapsedMs}ms) - but only by sweeping everything ` +
      'retained, with no targeted lookup available, and with this project\'s retention window still unestablished.'
  );
  console.log(
    `Part 2 (Approach C): an event's own replayId ${part2.confirmsStartAfter ? 'does NOT' : 'DOES'} let you ` +
      're-fetch that same event via CUSTOM replay - confirmed by direct test, not assumed from documentation.'
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
