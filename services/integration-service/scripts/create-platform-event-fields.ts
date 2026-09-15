import { config } from '../src/config';
import { createCustomField, CustomFieldSpec } from './lib/salesforceTooling';

/**
 * Creates the remaining canonical DistributorOnboardingRequested fields on
 * the Distributor_Onboarding_Requested__e Platform Event. One-time setup
 * script, not part of the integration flow itself.
 *
 * Field design maps the nested canonical event (CLAUDE.md) onto flat
 * fields, since Platform Events can't have nested objects - see
 * docs/decisions/0003-platform-event-schema.md.
 */
const FIELDS: CustomFieldSpec[] = [
  { fieldName: 'Event_Id__c', label: 'Event Id', length: 36 },
  { fieldName: 'Event_Version__c', label: 'Event Version', length: 10 },
  { fieldName: 'Correlation_Id__c', label: 'Correlation Id', length: 36 },
  { fieldName: 'Distributor_External_Id__c', label: 'Distributor External Id', length: 255 },
  { fieldName: 'Primary_Contact_Name__c', label: 'Primary Contact Name', length: 255 },
  { fieldName: 'Primary_Contact_Email__c', label: 'Primary Contact Email', length: 255 },
  { fieldName: 'Opportunity_Id__c', label: 'Opportunity Id', length: 18 },
  { fieldName: 'Account_Id__c', label: 'Account Id', length: 18 },
  { fieldName: 'Sales_Owner__c', label: 'Sales Owner', length: 255 },
];

async function main() {
  const objectApiName = config.salesforce.pubsubTopic.replace(/^\/event\//, '');

  for (const field of FIELDS) {
    const { success, body } = await createCustomField(objectApiName, field);
    if (!success) {
      console.error(`FAILED ${field.fieldName}:`, JSON.stringify(body));
    } else {
      console.log(`Created ${field.fieldName}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
