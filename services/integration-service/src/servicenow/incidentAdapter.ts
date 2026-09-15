import { config } from '../config';
import { authenticate } from './auth';
import { DistributorOnboardingRequestedEvent } from '../types/events';

/**
 * Creates a ServiceNow Incident representing a distributor onboarding
 * request, via the Table API. This is the smallest useful ServiceNow-side
 * action to prove the Salesforce -> Integration Service -> ServiceNow
 * chain end-to-end - see docs/decisions/0004-servicenow-authentication.md.
 *
 * Uses the standard `correlation_id` field to carry the canonical event's
 * correlationId, so this Incident can be traced back to the originating
 * Salesforce event.
 */
export async function createOnboardingIncident(
  event: DistributorOnboardingRequestedEvent
): Promise<{ sysId: string; number: string }> {
  const { accessToken } = await authenticate();

  const response = await fetch(`${config.serviceNow.instanceUrl}/api/now/table/incident`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      short_description: `Distributor onboarding requested: ${event.distributor.name}`,
      description:
        `Distributor: ${event.distributor.name} (external ID: ${event.distributor.externalId})\n` +
        `Primary contact: ${event.distributor.primaryContact.name} <${event.distributor.primaryContact.email}>\n` +
        `Sales owner: ${event.sales.owner}\n` +
        `Opportunity: ${event.sales.opportunityId}\n` +
        `Account: ${event.sales.accountId}\n` +
        `Event ID: ${event.eventId}`,
      correlation_id: event.correlationId,
    }),
  });

  const body = (await response.json()) as { result?: { sys_id: string; number: string } };

  if (!response.ok) {
    throw new Error(`ServiceNow Incident creation failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return { sysId: body.result!.sys_id, number: body.result!.number };
}
