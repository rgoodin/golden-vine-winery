import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderNameFor } from '../src/sharepoint/workspaceFolderName';

/**
 * Real, mock-free test - folderNameFor() is pure string logic, no I/O.
 * This is the function both workspaceAdapter.ts (create) and
 * workspaceReconciliation.ts (find) call, so its determinism is the
 * property that makes reconciliation actually work - see
 * src/sharepoint/workspaceFolderName.ts.
 */

test('folderNameFor: embeds the correlationId and distributor name deterministically', () => {
  const name = folderNameFor({
    correlationId: 'corr-456',
    distributor: { externalId: 'EXT-1', name: 'Acme Distribution', primaryContact: { name: '', email: '' } },
  });
  assert.equal(name, 'corr-456__Acme Distribution');
});

test('folderNameFor: is deterministic - the same event always produces the same name', () => {
  const event = {
    correlationId: 'corr-789',
    distributor: { externalId: 'EXT-2', name: 'Beta Wines', primaryContact: { name: '', email: '' } },
  };
  assert.equal(folderNameFor(event), folderNameFor(event));
});

test('folderNameFor: sanitizes characters SharePoint folder names disallow', () => {
  const name = folderNameFor({
    correlationId: 'corr-1',
    distributor: { externalId: 'EXT-3', name: 'A/B "Wines": <Reserve>?', primaryContact: { name: '', email: '' } },
  });
  assert.doesNotMatch(name.split('__')[1], /["*:<>?/\\|]/);
});

test('folderNameFor: trims leading/trailing periods and spaces SharePoint disallows at the edges', () => {
  const name = folderNameFor({
    correlationId: 'corr-2',
    distributor: { externalId: 'EXT-4', name: '  .Vintage Imports.  ', primaryContact: { name: '', email: '' } },
  });
  const distributorSegment = name.split('__')[1];
  assert.equal(distributorSegment.at(0), 'V');
  assert.equal(distributorSegment.at(-1), 's');
});
