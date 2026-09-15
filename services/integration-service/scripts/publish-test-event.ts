import { randomUUID } from 'crypto';
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

  const payload = {
    Event_Id__c: randomUUID(),
    Event_Version__c: '1.0',
    Correlation_Id__c: randomUUID(),
    Distributor_Name__c: distributorName,
    Distributor_External_Id__c: 'EXT-12345',
    Primary_Contact_Name__c: 'Jane Doe',
    Primary_Contact_Email__c: 'jane.doe@example.com',
    Opportunity_Id__c: '006000000000001',
    Account_Id__c: '001000000000001',
    Sales_Owner__c: 'John Smith',
  };

  const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/${objectApiName}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Publish failed (${response.status}): ${JSON.stringify(body)}`);
  }

  console.log('Published test event:', payload);
  console.log('Result:', body);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
