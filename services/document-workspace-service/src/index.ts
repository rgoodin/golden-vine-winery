import { config } from './config';
import { subscribeToDistributorOnboardingEvents } from './salesforce/subscriber';
import { processDistributorDocumentWorkspaceRequest } from './processDistributorDocumentWorkspaceRequest';

async function main() {
  console.log('Golden Vine document workspace service starting...');
  console.log(`Subscribing to Salesforce topic: ${config.salesforce.pubsubTopic}`);

  await subscribeToDistributorOnboardingEvents(async (event) => {
    console.log('Received DistributorOnboardingRequested event:', event);
    await processDistributorDocumentWorkspaceRequest(event);
  });
}

main().catch((err) => {
  console.error('Document workspace service failed to start:', err.message);
  process.exit(1);
});
