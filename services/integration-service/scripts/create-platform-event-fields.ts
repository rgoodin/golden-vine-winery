import { authenticate } from '../src/salesforce/auth';
import { config } from '../src/config';

/**
 * Creates the remaining canonical DistributorOnboardingRequested fields on
 * the Distributor_Onboarding_Requested__e Platform Event via the Tooling
 * API's CustomField sobject. One-time setup script, not part of the
 * integration flow itself.
 *
 * Field design maps the nested canonical event (CLAUDE.md) onto flat
 * fields, since Platform Events can't have nested objects - see
 * docs/decisions/0003-platform-event-schema.md.
 */

interface FieldSpec {
  fieldName: string;
  label: string;
  length: number;
}

const FIELDS: FieldSpec[] = [
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
  const { accessToken, instanceUrl } = await authenticate();
  const objectApiName = config.salesforce.pubsubTopic.replace(/^\/event\//, '');

  for (const field of FIELDS) {
    const response = await fetch(`${instanceUrl}/services/data/v60.0/tooling/sobjects/CustomField/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        FullName: `${objectApiName}.${field.fieldName}`,
        Metadata: {
          label: field.label,
          type: 'Text',
          length: field.length,
          required: false,
        },
      }),
    });

    const body = await response.json();

    if (!response.ok) {
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
