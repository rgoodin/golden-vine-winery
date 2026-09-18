import { authenticate } from 'golden-path-salesforce-transport';
import { config } from '../../src/config';

export interface CustomFieldSpec {
  fieldName: string;
  label: string;
  length: number;
}

/**
 * Creates one custom Text field on a Salesforce object via the Tooling
 * API's CustomField sobject. Extracted from create-platform-event-fields.ts
 * so future schema-setup scripts (for this or another Salesforce object)
 * don't have to re-derive the Tooling API call shape - see
 * docs/devex/lessons-learned.md LL-0004.
 */
export async function createCustomField(
  objectApiName: string,
  field: CustomFieldSpec
): Promise<{ success: boolean; body: unknown }> {
  const { accessToken, instanceUrl } = await authenticate(config.salesforce);

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
  return { success: response.ok, body };
}
