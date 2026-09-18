/**
 * Canonical DistributorOnboardingRequested event, as sketched in CLAUDE.md.
 *
 * This is this service's own copy of the type, not imported from
 * services/integration-service - see docs/golden-path/create.md ("your
 * canonical business event type"). It looks the same because both
 * services consume the same underlying Salesforce Platform Event; that
 * is a property of the source data, not a reason to share the type
 * definition across two otherwise-independent integrations.
 */
export interface DistributorOnboardingRequestedEvent {
  eventType: 'DistributorOnboardingRequested';
  eventVersion: string;
  eventId: string;
  correlationId: string;
  timestamp: string;
  distributor: {
    externalId: string;
    name: string;
    primaryContact: {
      name: string;
      email: string;
    };
  };
  sales: {
    opportunityId: string;
    accountId: string;
    owner: string;
  };
}
