import { DistributorOnboardingRequestedEvent } from './types/events';
import { createDistributorWorkspaceFolder } from './sharepoint/workspaceAdapter';
import { findDistributorWorkspaceFolder } from './sharepoint/workspaceReconciliation';
import { reclaimOperation, completeOperation, getOperation } from 'golden-path-reliability';

export interface RecoveryResult {
  businessOperationId: string;
  reclaimed: boolean;
  foundExisting?: boolean;
  folder?: { id: string; name: string; webUrl: string };
}

/**
 * Stale-operation recovery - mirrors integration-service's
 * recoverStaleDistributorOnboardingOperation.ts shape exactly
 * (reclaim -> target reconciliation -> complete-or-create), reusing
 * golden-path-reliability unchanged. Takes the full original event,
 * not just the business-operation ID, for the same reason: the
 * durable store never persists event payloads (see
 * docs/decisions/0006-tier1-recovery-payload-sourcing.md), and
 * findDistributorWorkspaceFolder() needs the event to recompute the
 * deterministic folder name.
 *
 * `staleAfterMs` is passed straight through to `reclaimOperation` -
 * this function has no opinion on the threshold, same as the
 * ServiceNow integration's equivalent.
 */
export async function recoverStaleDocumentWorkspaceOperation(
  event: DistributorOnboardingRequestedEvent,
  staleAfterMs: number
): Promise<RecoveryResult> {
  if (!event.correlationId) {
    throw new Error(
      `Event ${event.eventId} has no business-operation identity (correlationId) - refusing to ` +
        'attempt recovery without one.'
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

  const existingFolder = await findDistributorWorkspaceFolder(event);
  if (existingFolder) {
    completeOperation(event.correlationId, existingFolder.id, existingFolder.name);
    console.log(
      `Recovery: found existing SharePoint workspace folder "${existingFolder.name}" for business operation ` +
        `${event.correlationId} - recording completion, not creating another.`
    );
    return {
      businessOperationId: event.correlationId,
      reclaimed: true,
      foundExisting: true,
      folder: existingFolder,
    };
  }

  const folder = await createDistributorWorkspaceFolder(event);
  completeOperation(event.correlationId, folder.id, folder.name);
  console.log(
    `Recovery: no existing workspace folder found for business operation ${event.correlationId} - created ` +
      `"${folder.name}" (${folder.id}).`
  );
  return { businessOperationId: event.correlationId, reclaimed: true, foundExisting: false, folder };
}
