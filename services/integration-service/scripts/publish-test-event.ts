import { authenticate } from '../src/salesforce/auth';
import { config } from '../src/config';

/**
 * Publishes a single test DistributorOnboardingRequested event via the
 * Salesforce REST API (sObject Platform Event publish), for exercising the
 * subscriber locally. Not part of the integration flow itself.
 */
async function main() {
  const distributorName = process.argv[2] ?? 'Test Distributor';

  const { accessToken, instanceUrl } = await authenticate();

  const objectApiName = config.salesforce.pubsubTopic.replace(/^\/event\//, '');

  const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/${objectApiName}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Distributor_Name__c: distributorName }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Publish failed (${response.status}): ${JSON.stringify(body)}`);
  }

  console.log('Published test event:', body);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
