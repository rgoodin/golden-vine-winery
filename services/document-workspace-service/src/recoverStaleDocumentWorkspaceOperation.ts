import { DistributorOnboardingRequestedEvent } from './types/events';
import { createDistributorWorkspaceFolder, WorkspaceFolderConflictError } from './sharepoint/workspaceAdapter';
import { findDistributorWorkspaceFolder } from './sharepoint/workspaceReconciliation';
import { reclaimOperation, completeOperation, getOperation } from 'golden-path-reliability';

export interface RecoveryResult {
  businessOperationId: string;
  reclaimed: boolean;
  foundExisting?: boolean;
  folder?: { id: string; name: string; webUrl: string };
}

/**
 * Stale-operation recovery - reclaim -> attempt create -> on a real
 * conflict, reconcile; on success, complete directly.
 *
 * This is deliberately create-first, not reconcile-first the way
 * integration-service's ServiceNow equivalent
 * (recoverStaleDistributorOnboardingOperation.ts) is. That shape was
 * inherited from ServiceNow, where a pre-check does real protective
 * work because ServiceNow's own Incident creation has no atomic
 * uniqueness guarantee. docs/decisions/0009-sharepoint-folder-creation-uniqueness.md
 * proved SharePoint's create (conflictBehavior: "fail") already IS an
 * atomic uniqueness check - a pre-check here would add no safety,
 * only an extra network call on every genuine-gap recovery (the common
 * case). Leaning on the proven guarantee instead: attempt create
 * directly; only fall back to a lookup on an actual
 * WorkspaceFolderConflictError, which happens in the rarer case where
 * the original owner's own delayed action has already succeeded. This
 * divergence from the ServiceNow integration's shape is itself
 * evidence-driven, not accidental drift - see
 * docs/golden-path/0002-design-principles.md ("abstractions are earned
 * through repetition") for why forcing the two integrations back into
 * an identical shape here would be wrong, not just inconsistent.
 *
 * Re-verified against the exact slow-owner race scenario this change
 * is meant to keep closed - see
 * docs/architecture/0002-sharepoint-target-side-uniqueness-spike.md and
 * docs/devex/observations.md OB-0035.
 *
 * Takes the full original event, not just the business-operation ID,
 * for the same reason as before: the durable store never persists
 * event payloads (docs/decisions/0006-tier1-recovery-payload-sourcing.md),
 * and both createDistributorWorkspaceFolder() and
 * findDistributorWorkspaceFolder() need the event to compute the
 * deterministic folder name.
 *
 * `staleAfterMs` is passed straight through to `reclaimOperation` -
 * this function has no opinion on the threshold.
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

  try {
    const folder = await createDistributorWorkspaceFolder(event);
    completeOperation(event.correlationId, folder.id, folder.name);
    console.log(
      `Recovery: no existing workspace folder found for business operation ${event.correlationId} - created ` +
        `"${folder.name}" (${folder.id}).`
    );
    return { businessOperationId: event.correlationId, reclaimed: true, foundExisting: false, folder };
  } catch (err) {
    if (!(err instanceof WorkspaceFolderConflictError)) {
      throw err;
    }

    console.log(
      `Recovery: create conflicted for business operation ${event.correlationId} - SharePoint's own uniqueness ` +
        'check (ADR 0009) rejected it, meaning the original owner\'s own action already succeeded. Looking up ' +
        'the existing folder rather than treating this as a failure.'
    );
    const existingFolder = await findDistributorWorkspaceFolder(event);
    if (!existingFolder) {
      throw new Error(
        `SharePoint reported a create conflict for business operation ${event.correlationId} but no matching ` +
          'folder could be found on lookup - investigate before treating this as recovered.'
      );
    }

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
}
