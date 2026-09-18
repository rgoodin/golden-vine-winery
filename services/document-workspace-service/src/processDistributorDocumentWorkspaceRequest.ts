import { DistributorOnboardingRequestedEvent } from './types/events';
import { createDistributorWorkspaceFolder } from './sharepoint/workspaceAdapter';
import { acquireOperation, completeOperation, getOperation } from 'golden-path-reliability';

export interface ProcessResult {
  businessOperationId: string;
  created: boolean;
  folder?: { id: string; name: string; webUrl: string };
}

/**
 * Normal processing path for a distributor document workspace request -
 * mirrors integration-service's processDistributorOnboardingEvent.ts
 * shape exactly (acquire -> target action -> complete), reusing
 * golden-path-reliability unchanged. See docs/golden-path/create.md
 * ("your orchestration").
 *
 * Keyed on correlationId, never eventId - same reasoning as the
 * ServiceNow integration (docs/devex/phase-2-observation-review.md
 * Finding 8, OB-0014).
 *
 * Does not yet cover stale-operation recovery (reclaim) - see
 * recoverStaleDocumentWorkspaceOperation.ts, invoked separately, same
 * as integration-service's equivalent split.
 */
export async function processDistributorDocumentWorkspaceRequest(
  event: DistributorOnboardingRequestedEvent
): Promise<ProcessResult> {
  if (!event.correlationId) {
    throw new Error(
      `Event ${event.eventId} has no business-operation identity (correlationId) - refusing to ` +
        'process without one.'
    );
  }

  const acquired = acquireOperation(event.correlationId);
  if (!acquired) {
    const existing = getOperation(event.correlationId);
    console.log(
      `Business operation ${event.correlationId} is already owned or completed ` +
        `(status=${existing?.status ?? 'unknown'}) - not creating another workspace folder. ` +
        `Salesforce event ID for this delivery: ${event.eventId}.`
    );
    return { businessOperationId: event.correlationId, created: false };
  }

  const folder = await createDistributorWorkspaceFolder(event);
  completeOperation(event.correlationId, folder.id, folder.name);
  console.log(
    `Created SharePoint workspace folder "${folder.name}" (${folder.id}) for business operation ${event.correlationId}`
  );
  return { businessOperationId: event.correlationId, created: true, folder };
}
