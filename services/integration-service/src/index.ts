import { config } from './config';
import { subscribeToDistributorOnboardingEvents } from './salesforce/subscriber';

async function main() {
  console.log('Golden Vine integration service starting...');
  console.log(`Subscribing to Salesforce topic: ${config.salesforce.pubsubTopic}`);

  await subscribeToDistributorOnboardingEvents(async (event) => {
    // Smallest useful behavior for Phase 1: prove the event arrives.
    // No ServiceNow call yet - that's the next slice, once this works.
    console.log('Received DistributorOnboardingRequested event:', event);
  });
}

main().catch((err) => {
  console.error('Integration service failed to start:', err.message);
  process.exit(1);
});
