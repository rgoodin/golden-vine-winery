import { config } from '../config';
import { subscribe } from 'golden-path-salesforce-transport';
import { DistributorOnboardingRequestedEvent } from '../types/events';

/**
 * Maps the flat Distributor_Onboarding_Requested__e fields onto the
 * canonical nested event shape. This service's own copy of the mapping
 * - see src/types/events.ts for why it is not imported from
 * services/integration-service despite looking the same.
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
 * Subscribes to the same Salesforce Platform Event topic
 * integration-service subscribes to, via this service's own
 * independent Pub/Sub subscription and checkpoint file (cwd-relative,
 * from golden-path-salesforce-transport - see that package's README).
 * Pub/Sub broadcasts each event to every independent subscriber, so
 * this requires no coordination with integration-service.
 */
export async function subscribeToDistributorOnboardingEvents(
  onEvent: (event: DistributorOnboardingRequestedEvent) => void | Promise<void>
): Promise<void> {
  await subscribe(config.salesforce, config.salesforce.pubsubTopic, async (raw) => {
    await onEvent(toCanonicalEvent(raw.payload));
  });
}
