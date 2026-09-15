import { config } from '../config';
import { subscribe, DecodedPubSubEvent } from './pubsubClient';

/**
 * Subscribes to the configured Platform Event topic via the Pub/Sub API and
 * invokes `onEvent` for each event received.
 *
 * NOTE: passes through the raw decoded Avro payload rather than the typed
 * DistributorOnboardingRequestedEvent from src/types/events.ts. Platform
 * Events are flat, so once the actual DistributorOnboardingRequested__e
 * object exists in Salesforce, its real field names need to be mapped onto
 * the canonical event shape here - see docs/devex/friction-log.md.
 */
export async function subscribeToDistributorOnboardingEvents(
  onEvent: (event: DecodedPubSubEvent) => void | Promise<void>
): Promise<void> {
  await subscribe(config.salesforce.pubsubTopic, onEvent);
}
