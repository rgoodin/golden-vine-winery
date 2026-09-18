import { config } from '../config';
import { authenticate } from './auth';
import { folderNameFor } from './workspaceFolderName';
import { DistributorOnboardingRequestedEvent } from '../types/events';
import { WorkspaceFolder } from './workspaceAdapter';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Given the original event, checks whether its distributor workspace
 * folder already exists in SharePoint - the target-reconciliation half
 * of recovery (docs/golden-path/create.md). Recomputes the same
 * deterministic name createDistributorWorkspaceFolder() used
 * (workspaceFolderName.ts), since that name IS this integration's
 * definition of "the same business operation" for this target - there
 * is no separate queryable correlation-id field to look up instead,
 * unlike ServiceNow's incidentReconciliation.ts.
 */
export async function findDistributorWorkspaceFolder(
  event: DistributorOnboardingRequestedEvent
): Promise<WorkspaceFolder | null> {
  const { accessToken } = await authenticate();
  const folderName = folderNameFor(event);

  const response = await fetch(
    `${GRAPH_BASE}/sites/${config.sharepoint.siteId}/drive/root:/${encodeURIComponent(config.sharepoint.workspaceFolder)}/${encodeURIComponent(folderName)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 404) {
    return null;
  }

  const body = (await response.json()) as { id?: string; name?: string; webUrl?: string };

  if (!response.ok) {
    throw new Error(`SharePoint workspace folder lookup failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return { id: body.id!, name: body.name!, webUrl: body.webUrl! };
}
