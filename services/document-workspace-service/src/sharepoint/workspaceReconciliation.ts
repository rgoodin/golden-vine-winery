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

/**
 * Lists every folder currently under the configured workspace root
 * folder, in one bulk read - the audit-tool counterpart to
 * findDistributorWorkspaceFolder()'s single-folder lookup.
 *
 * This is a genuinely different shape from ServiceNow's audit
 * (detect-unprocessed-events.ts), not a mechanical port of it.
 * ServiceNow has an indexed `correlation_id` field, so its audit issues
 * one filtered query per Salesforce event. SharePoint has no such
 * field - the only way to know what exists is to list the folder and
 * inspect names. Querying the target once per event here would mean N
 * Graph calls for N events; listing once per run and classifying every
 * event against that single in-memory snapshot is the shape SharePoint
 * actually calls for. See docs/devex/phase-6-iteration-review.md
 * Finding 4 and docs/devex/observations.md for the live verification of
 * this specific behavior (pagination, and the empty-site case below).
 *
 * Handles two cases a native-field-based query never has to:
 * - **Pagination**: Graph's default page size can be smaller than the
 *   real folder count; every `@odata.nextLink` is followed until
 *   exhausted, so a large site can't silently under-report.
 * - **The workspace root folder not existing yet**: a brand new site
 *   (or a wrong/renamed `SHAREPOINT_WORKSPACE_FOLDER`) 404s on this
 *   path - treated as "zero folders processed yet," not an error, the
 *   same way an audit against an empty ServiceNow table would find
 *   zero Incidents rather than fail.
 */
export async function listWorkspaceFolders(): Promise<WorkspaceFolder[]> {
  const { accessToken } = await authenticate();
  const folders: WorkspaceFolder[] = [];

  let url: string | undefined =
    `${GRAPH_BASE}/sites/${config.sharepoint.siteId}/drive/root:/${encodeURIComponent(config.sharepoint.workspaceFolder)}:/children?$select=id,name,webUrl&$top=200`;

  while (url) {
    const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (response.status === 404) {
      // Workspace root folder doesn't exist yet - no distributor has
      // ever been processed against this site. Zero folders, not a
      // failure - the caller (the audit tool) still gets a real,
      // trustworthy answer for every event it classifies against this.
      return folders;
    }

    const body = (await response.json()) as {
      value?: { id: string; name: string; webUrl: string }[];
      '@odata.nextLink'?: string;
    };

    if (!response.ok) {
      throw new Error(`SharePoint workspace folder listing failed (${response.status}): ${JSON.stringify(body)}`);
    }

    for (const item of body.value ?? []) {
      folders.push({ id: item.id, name: item.name, webUrl: item.webUrl });
    }
    url = body['@odata.nextLink'];
  }

  return folders;
}
