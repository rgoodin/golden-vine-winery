import { config } from './config';
import { subscribeToDistributorOnboardingEvents } from './salesforce/subscriber';
import { processDistributorOnboardingEvent } from './processDistributorOnboardingEvent';

async function main() {
  console.log('Golden Vine integration service starting...');
  console.log(`Subscribing to Salesforce topic: ${config.salesforce.pubsubTopic}`);

  await subscribeToDistributorOnboardingEvents(async (event) => {
    console.log('Received DistributorOnboardingRequested event:', event);
    await processDistributorOnboardingEvent(event);
  });
}

main().catch((err) => {
  console.error('Integration service failed to start:', err.message);
  process.exit(1);
});
