import { config } from './config';
import { subscribeToDistributorOnboardingEvents } from './salesforce/subscriber';
import { createOnboardingIncident } from './servicenow/incidentAdapter';

async function main() {
  console.log('Golden Vine integration service starting...');
  console.log(`Subscribing to Salesforce topic: ${config.salesforce.pubsubTopic}`);

  await subscribeToDistributorOnboardingEvents(async (event) => {
    console.log('Received DistributorOnboardingRequested event:', event);

    const incident = await createOnboardingIncident(event);
    console.log(`Created ServiceNow Incident ${incident.number} (${incident.sysId})`);
  });
}

main().catch((err) => {
  console.error('Integration service failed to start:', err.message);
  process.exit(1);
});
