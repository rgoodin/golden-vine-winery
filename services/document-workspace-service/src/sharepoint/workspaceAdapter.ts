import { config } from '../config';
import { authenticate } from './auth';
import { folderNameFor } from './workspaceFolderName';
import { DistributorOnboardingRequestedEvent } from '../types/events';

export interface WorkspaceFolder {
  id: string;
  name: string;
  webUrl: string;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Ensures the configured workspace root folder exists under the site's
 * default document library, creating it on first use. Idempotent - an
 * already-existing folder is left as-is, never recreated.
 */
async function ensureWorkspaceRootFolder(accessToken: string): Promise<void> {
  const checkResponse = await fetch(
    `${GRAPH_BASE}/sites/${config.sharepoint.siteId}/drive/root:/${encodeURIComponent(config.sharepoint.workspaceFolder)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (checkResponse.ok) {
    return;
  }
  if (checkResponse.status !== 404) {
    const body = await checkResponse.json();
    throw new Error(`Checking workspace root folder failed (${checkResponse.status}): ${JSON.stringify(body)}`);
  }

  const createResponse = await fetch(`${GRAPH_BASE}/sites/${config.sharepoint.siteId}/drive/root/children`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: config.sharepoint.workspaceFolder,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'replace',
    }),
  });
  if (!createResponse.ok) {
    const body = await createResponse.json();
    throw new Error(`Creating workspace root folder failed (${createResponse.status}): ${JSON.stringify(body)}`);
  }
}

/**
 * Creates a SharePoint folder representing a distributor's document
 * workspace. This is the smallest useful SharePoint-side action to
 * prove the Salesforce -> document-workspace-service -> SharePoint
 * chain end-to-end - see docs/decisions/0008-sharepoint-authentication.md
 * and docs/golden-path/create.md.
 *
 * Uses "fail" conflict behavior - unlike ServiceNow's unconditional
 * Incident creation, Graph gives a real conflict signal for a
 * duplicate name, surfaced here as an error rather than a silent
 * second success. Callers are expected to have already checked
 * workspaceReconciliation.ts before calling this for a given business
 * operation.
 */
export async function createDistributorWorkspaceFolder(
  event: DistributorOnboardingRequestedEvent
): Promise<WorkspaceFolder> {
  const { accessToken } = await authenticate();
  await ensureWorkspaceRootFolder(accessToken);

  const folderName = folderNameFor(event);
  const response = await fetch(
    `${GRAPH_BASE}/sites/${config.sharepoint.siteId}/drive/root:/${encodeURIComponent(config.sharepoint.workspaceFolder)}:/children`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    }
  );

  const body = (await response.json()) as { id?: string; name?: string; webUrl?: string };

  if (!response.ok) {
    throw new Error(`SharePoint workspace folder creation failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return { id: body.id!, name: body.name!, webUrl: body.webUrl! };
}
