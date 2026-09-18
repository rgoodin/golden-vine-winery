import { DistributorOnboardingRequestedEvent } from '../types/events';

/**
 * SharePoint folders have no native "correlation ID" field the way a
 * ServiceNow Incident does (docs/golden-path/create.md: "this is where
 * your definition of duplicate actually lives in code"). Encoding the
 * business-operation identity directly into the folder name makes
 * lookup-by-correlation-id equivalent to lookup-by-name, with no
 * custom metadata needed - see workspaceAdapter.ts and
 * workspaceReconciliation.ts, which both call this function so the
 * name they compute can never drift apart.
 *
 * SharePoint folder names disallow `" * : < > ? / \ |` and a leading/
 * trailing space or period - only the distributor-name segment needs
 * sanitizing; correlationId is a UUID and never needs it.
 */
export function folderNameFor(
  event: Pick<DistributorOnboardingRequestedEvent, 'correlationId' | 'distributor'>
): string {
  const sanitizedDistributorName = event.distributor.name
    .replace(/["*:<>?/\\|]/g, '-')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100);
  return `${event.correlationId}__${sanitizedDistributorName}`;
}
