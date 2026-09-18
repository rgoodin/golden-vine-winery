import { DistributorOnboardingRequestedEvent } from './types/events';
import { createOnboardingIncident } from './servicenow/incidentAdapter';
import { acquireOperation, completeOperation, getOperation } from 'golden-path-reliability';

export interface ProcessResult {
  businessOperationId: string;
  created: boolean;
  incident?: { sysId: string; number: string };
}

/**
 * Tier 1 processing path (docs/decisions/0005-external-side-effect-reliability-contract.md):
 *
 *   Salesforce event -> business-operation identity -> atomic durable
 *   acquire -> (acquired: ServiceNow create -> record completion) |
 *   (already owned/completed: do not create)
 *
 * Keyed on `correlationId` - the business-operation identity - never
 * `eventId`, which identifies this particular Salesforce delivery and
 * says nothing about whether another delivery already represents the
 * same real-world operation (OB-0014).
 *
 * Extracted from the subscriber's event callback as a named, exported
 * function specifically so it can be exercised directly - the real
 * production code path, not a reimplementation of it - without needing
 * two live Pub/Sub subscriptions (which would also contend over the
 * single-instance checkpoint file, a separate, pre-existing concern
 * unrelated to what this function is responsible for).
 *
 * Does not yet cover stale-operation recovery (reclaim) or target
 * reconciliation - both branches return normally, so the caller's
 * existing checkpoint-after-onEvent behavior advances the replay
 * position regardless of which branch was taken. See the ADR for why
 * that is a deliberate, documented scope boundary for this Enablement
 * round, not an oversight.
 */
export async function processDistributorOnboardingEvent(
  event: DistributorOnboardingRequestedEvent
): Promise<ProcessResult> {
  if (!event.correlationId) {
    throw new Error(
      `Event ${event.eventId} has no business-operation identity (correlationId) - refusing to ` +
        'process without one, rather than fall back to a weaker identity. See ' +
        'docs/decisions/0005-external-side-effect-reliability-contract.md.'
    );
  }

  const acquired = acquireOperation(event.correlationId);
  if (!acquired) {
    const existing = getOperation(event.correlationId);
    console.log(
      `Business operation ${event.correlationId} is already owned or completed ` +
        `(status=${existing?.status ?? 'unknown'}${
          existing?.incidentNumber ? `, incident=${existing.incidentNumber}` : ''
        }) - not creating another Incident. Salesforce event ID for this delivery: ${event.eventId}.`
    );
    return { businessOperationId: event.correlationId, created: false };
  }

  const incident = await createOnboardingIncident(event);
  completeOperation(event.correlationId, incident.sysId, incident.number);
  console.log(
    `Created ServiceNow Incident ${incident.number} (${incident.sysId}) for business operation ${event.correlationId}`
  );
  return { businessOperationId: event.correlationId, created: true, incident };
}
