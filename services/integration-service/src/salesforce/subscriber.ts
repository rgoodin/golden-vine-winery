import { config } from '../config';
import { subscribe } from 'golden-path-salesforce-transport';
import { DistributorOnboardingRequestedEvent } from '../types/events';

/**
 * Maps the flat Distributor_Onboarding_Requested__e fields onto the
 * canonical nested event shape. Platform Events can't have nested objects,
 * so this flattening/remapping is the boundary between Salesforce's actual
 * schema and our canonical contract - see
 * docs/decisions/0003-platform-event-schema.md.
 *
 * Exported so anything that reads a raw decoded Platform Event directly -
 * e.g. `scripts/detect-unprocessed-events.ts`, which already holds a raw
 * event via `replayRange()` when it classifies a GAP - can reuse the exact
 * same mapping recovery expects, instead of a second, drifting copy of it.
 */
export function toCanonicalEvent(raw: Record<string, unknown>): DistributorOnboardingRequestedEvent {
  return {
    eventType: 'DistributorOnboardingRequested',
    eventVersion: String(raw.Event_Version__c ?? ''),
    eventId: String(raw.Event_Id__c ?? ''),
    correlationId: String(raw.Correlation_Id__c ?? ''),
    timestamp: new Date(raw.CreatedDate as number).toISOString(),
    distributor: {
      externalId: String(raw.Distributor_External_Id__c ?? ''),
      name: String(raw.Distributor_Name__c ?? ''),
      primaryContact: {
        name: String(raw.Primary_Contact_Name__c ?? ''),
        email: String(raw.Primary_Contact_Email__c ?? ''),
      },
    },
    sales: {
      opportunityId: String(raw.Opportunity_Id__c ?? ''),
      accountId: String(raw.Account_Id__c ?? ''),
      owner: String(raw.Sales_Owner__c ?? ''),
    },
  };
}

/**
 * Subscribes to the configured Platform Event topic via the Pub/Sub API and
 * invokes `onEvent` with each event mapped onto the canonical
 * DistributorOnboardingRequestedEvent shape.
 */
export async function subscribeToDistributorOnboardingEvents(
  onEvent: (event: DistributorOnboardingRequestedEvent) => void | Promise<void>
): Promise<void> {
  await subscribe(config.salesforce, config.salesforce.pubsubTopic, async (raw) => {
    await onEvent(toCanonicalEvent(raw.payload));
  });
}
