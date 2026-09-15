import type { DistributorOnboardingRequestedEvent } from '../types/events';

/**
 * Subscribes to the DistributorOnboardingRequested Platform Event via
 * Salesforce's Pub/Sub API and invokes `onEvent` for each event received.
 *
 * NOT YET IMPLEMENTED. The Pub/Sub API is gRPC-based and requires, at
 * minimum: an OAuth authentication flow (not yet chosen), the Pub/Sub API's
 * .proto definitions and a gRPC client, and Avro schema retrieval/decoding
 * for the event payload.
 *
 * See docs/devex/friction-log.md FL-0001 for the open questions blocking
 * this implementation.
 */
export async function subscribeToDistributorOnboardingEvents(
  onEvent: (event: DistributorOnboardingRequestedEvent) => Promise<void>
): Promise<void> {
  throw new Error(
    'subscribeToDistributorOnboardingEvents() is not yet implemented - see docs/devex/friction-log.md FL-0001'
  );
}
