import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { acquireOperation, reclaimOperation, completeOperation, getOperation } from '../src/idempotencyStore';

/**
 * Real, local, mock-free tests against a real node:sqlite database - no
 * external system involved, so no reason to fake this behavior. Every
 * test uses a fresh randomUUID() business-operation ID so tests never
 * collide with each other or with leftover state, the same convention
 * this project's own live verification scripts already use.
 *
 * This tests the same properties this module's own doc comments claim
 * and that were originally established experimentally (OB-0017,
 * OB-0020, OB-0021) - "constraint decides, not a prior read" - not new
 * behavior. The genuine multi-process concurrency claims (OB-0017's
 * 5/5 trials, OB-0022's slow-owner race) are NOT re-tested here; a
 * single-process unit test cannot exercise real OS-level concurrency -
 * that evidence lives in golden-vine-winery's
 * scripts/test-production-concurrent-idempotency.ts and
 * scripts/lib/slowWorkerA.ts/slowWorkerB.ts, run against real systems,
 * deliberately not replaced by this suite.
 */

test('acquireOperation: first call succeeds, second call for the same ID fails', () => {
  const id = randomUUID();
  assert.equal(acquireOperation(id), true);
  assert.equal(acquireOperation(id), false);
});

test('acquireOperation: different IDs do not interfere with each other', () => {
  const idA = randomUUID();
  const idB = randomUUID();
  assert.equal(acquireOperation(idA), true);
  assert.equal(acquireOperation(idB), true);
});

test('getOperation: returns null for an ID that was never acquired', () => {
  const id = randomUUID();
  assert.equal(getOperation(id), null);
});

test('getOperation: reflects in_flight state immediately after acquire', () => {
  const id = randomUUID();
  acquireOperation(id);
  const record = getOperation(id);
  assert.ok(record);
  assert.equal(record?.businessOperationId, id);
  assert.equal(record?.status, 'in_flight');
  assert.equal(record?.incidentSysId, null);
  assert.equal(record?.incidentNumber, null);
  assert.equal(record?.completedAt, null);
  assert.ok(record?.acquiredAt);
});

test('completeOperation: records status and evidence, visible via getOperation', () => {
  const id = randomUUID();
  acquireOperation(id);
  completeOperation(id, 'sys-id-123', 'EVID-001');
  const record = getOperation(id);
  assert.equal(record?.status, 'completed');
  assert.equal(record?.incidentSysId, 'sys-id-123');
  assert.equal(record?.incidentNumber, 'EVID-001');
  assert.ok(record?.completedAt);
});

test('reclaimOperation: fails for an ID that was never acquired', () => {
  const id = randomUUID();
  assert.equal(reclaimOperation(id, 1), false);
});

test('reclaimOperation: fails for a completed operation, regardless of threshold', async () => {
  const id = randomUUID();
  acquireOperation(id);
  completeOperation(id, 'sys-id', 'EVID');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(reclaimOperation(id, 1), false);
  const record = getOperation(id);
  assert.equal(record?.status, 'completed');
});

test('reclaimOperation: fails for an in_flight operation that is not yet stale under the given threshold', () => {
  const id = randomUUID();
  acquireOperation(id);
  assert.equal(reclaimOperation(id, 60_000), false);
  const record = getOperation(id);
  assert.equal(record?.status, 'in_flight');
});

test('reclaimOperation: succeeds for an in_flight operation once it is stale under the given threshold', async () => {
  const id = randomUUID();
  acquireOperation(id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reclaimOperation(id, 10), true);
  const record = getOperation(id);
  assert.equal(record?.status, 'in_flight'); // reclaim refreshes ownership, does not complete it
});

test('reclaimOperation: exactly one of two reclaim attempts for the same stale ID succeeds', async () => {
  const id = randomUUID();
  acquireOperation(id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const results = [reclaimOperation(id, 10), reclaimOperation(id, 10)];
  const successCount = results.filter(Boolean).length;
  assert.equal(
    successCount,
    1,
    'the second reclaim should find acquired_at already refreshed by the first and no longer stale'
  );
});
