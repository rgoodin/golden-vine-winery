/**
 * Canonical DistributorOnboardingRequested event, as sketched in CLAUDE.md.
 * This is a starting contract, not a confirmed schema - change it when
 * implementation experience demonstrates a better design.
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
