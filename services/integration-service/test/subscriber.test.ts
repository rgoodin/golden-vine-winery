import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCanonicalEvent } from '../src/salesforce/subscriber';

/**
 * Real, mock-free test - toCanonicalEvent() is a pure data transformation
 * (flat raw Platform Event fields -> canonical nested shape), no I/O, no
 * external system, no reason to fake this.
 */

const FULL_RAW_PAYLOAD = {
  Event_Version__c: '1.0',
  Event_Id__c: 'evt-123',
  Correlation_Id__c: 'corr-456',
  CreatedDate: 1700000000000,
  Distributor_External_Id__c: 'EXT-1',
  Distributor_Name__c: 'Acme Distribution',
  Primary_Contact_Name__c: 'Jane Doe',
  Primary_Contact_Email__c: 'jane.doe@example.com',
  Opportunity_Id__c: '006000000000001',
  Account_Id__c: '001000000000001',
  Sales_Owner__c: 'John Smith',
};

test('toCanonicalEvent: maps every flat field onto the correct nested location', () => {
  const canonical = toCanonicalEvent(FULL_RAW_PAYLOAD);

  assert.equal(canonical.eventType, 'DistributorOnboardingRequested');
  assert.equal(canonical.eventVersion, '1.0');
  assert.equal(canonical.eventId, 'evt-123');
  assert.equal(canonical.correlationId, 'corr-456');
  assert.equal(canonical.timestamp, new Date(1700000000000).toISOString());
  assert.deepEqual(canonical.distributor, {
    externalId: 'EXT-1',
    name: 'Acme Distribution',
    primaryContact: { name: 'Jane Doe', email: 'jane.doe@example.com' },
  });
  assert.deepEqual(canonical.sales, {
    opportunityId: '006000000000001',
    accountId: '001000000000001',
    owner: 'John Smith',
  });
});

test('toCanonicalEvent: eventId and correlationId are kept distinct, never conflated', () => {
  // Guards the specific distinction this project's own history (OB-0014)
  // established as load-bearing: delivery identity vs. business-operation
  // identity are different fields and must never collapse into one.
  const canonical = toCanonicalEvent({ ...FULL_RAW_PAYLOAD, Event_Id__c: 'evt-A', Correlation_Id__c: 'corr-B' });
  assert.equal(canonical.eventId, 'evt-A');
  assert.equal(canonical.correlationId, 'corr-B');
  assert.notEqual(canonical.eventId, canonical.correlationId);
});

test('toCanonicalEvent: missing fields become empty strings, not "undefined" or thrown errors', () => {
  const canonical = toCanonicalEvent({ CreatedDate: 1700000000000 });

  assert.equal(canonical.eventId, '');
  assert.equal(canonical.correlationId, '');
  assert.equal(canonical.distributor.name, '');
  assert.equal(canonical.distributor.primaryContact.email, '');
  assert.equal(canonical.sales.owner, '');
});
