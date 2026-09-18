import { DistributorOnboardingRequestedEvent } from './types/events';
import { createOnboardingIncident } from './servicenow/incidentAdapter';
import { findIncidentByCorrelationId } from './servicenow/incidentReconciliation';
import { reclaimOperation, completeOperation, getOperation } from 'golden-path-reliability';

export interface RecoveryResult {
  businessOperationId: string;
  reclaimed: boolean;
  foundExisting?: boolean;
  incident?: { sysId: string; number: string };
}

/**
 * Tier 1 stale-operation recovery (docs/decisions/0005-external-side-effect-reliability-contract.md):
 *
 *   stale in_flight -> atomic reclaim -> query ServiceNow by
 *   business-operation ID -> (exists: complete locally with the
 *   discovered Incident) | (absent: create Incident -> complete locally)
 *
 * Production form of the mechanism validated experimentally in
 * `scripts/test-durable-state-reclaim-reconciliation.ts` (OB-0020,
 * OB-0021), covering both previously reproduced crash boundaries:
 * crash before the ServiceNow call (reconciliation finds nothing, so it
 * creates) and crash after ServiceNow succeeds but before local
 * completion is recorded (reconciliation finds the existing Incident, so
 * it does not create another).
 *
 * Takes the full original event, not just the business-operation ID,
 * because the idempotency store deliberately does not durably persist
 * event payloads (see `src/reliability/idempotencyStore.ts`) - recovery
 * needs Salesforce's own replay capability (`pubsubClient.ts`'s
 * `replayRange()`, already validated in OB-0011) to supply the data
 * needed to create the Incident in the "absent" branch, not a second
 * local copy of it. This function does not perform that replay itself -
 * it is the smallest orchestration a caller (today: a developer or a
 * script; later: a recovery worker - not built this round) can invoke
 * once it already has the event in hand.
 *
 * `staleAfterMs` is passed straight through to `reclaimOperation` - this
 * function has no opinion on the threshold either. If the operation
 * cannot be reclaimed (never acquired, still fresh, or already
 * completed), this returns immediately without contacting ServiceNow at
 * all - recovery cannot be accidentally invoked on ordinary new or
 * healthy in-flight processing, by construction of `reclaimOperation`'s
 * own `WHERE` clause, not by a check this function adds on top.
 *
 * "Stale" means eligible for recovery under the caller's chosen policy,
 * not proven dead - a genuinely slow-but-still-running original owner
 * can still be reclaimed here while its own ServiceNow call is in
 * flight (OB-0022). That race is preserved, not solved, by this
 * function or anything that calls it.
 */
export async function recoverStaleDistributorOnboardingOperation(
  event: DistributorOnboardingRequestedEvent,
  staleAfterMs: number
): Promise<RecoveryResult> {
  if (!event.correlationId) {
    throw new Error(
      `Event ${event.eventId} has no business-operation identity (correlationId) - refusing to ` +
        'attempt recovery without one. See docs/decisions/0005-external-side-effect-reliability-contract.md.'
    );
  }

  const reclaimed = reclaimOperation(event.correlationId, staleAfterMs);
  if (!reclaimed) {
    const existing = getOperation(event.correlationId);
    console.log(
      `Business operation ${event.correlationId} was not reclaimed - ` +
        `${existing ? `status=${existing.status}, not stale under a ${staleAfterMs}ms threshold` : 'no durable record exists'}. ` +
        'Not recovering.'
    );
    return { businessOperationId: event.correlationId, reclaimed: false };
  }

  const existingIncident = await findIncidentByCorrelationId(event.correlationId);
  if (existingIncident) {
    completeOperation(event.correlationId, existingIncident.sysId, existingIncident.number);
    console.log(
      `Recovery: found existing ServiceNow Incident ${existingIncident.number} for business operation ` +
        `${event.correlationId} - recording completion, not creating another.`
    );
    return {
      businessOperationId: event.correlationId,
      reclaimed: true,
      foundExisting: true,
      incident: existingIncident,
    };
  }

  const incident = await createOnboardingIncident(event);
  completeOperation(event.correlationId, incident.sysId, incident.number);
  console.log(
    `Recovery: no existing Incident found for business operation ${event.correlationId} - created ` +
      `${incident.number} (${incident.sysId}).`
  );
  return { businessOperationId: event.correlationId, reclaimed: true, foundExisting: false, incident };
}
