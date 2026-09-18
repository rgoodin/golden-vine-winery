import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadCheckpoint, saveCheckpoint } from '../src/checkpoint';

/**
 * Real, local, mock-free tests - pure file I/O, no network, no reason to
 * fake this. Each test uses its own temp file path (a fresh randomUUID()
 * under the OS temp directory) via the optional `checkpointPath`
 * parameter, so tests never collide and never touch a real service's
 * `.checkpoint.json`.
 */

function tempCheckpointPath(): string {
  return path.join(os.tmpdir(), `golden-path-checkpoint-test-${randomUUID()}.json`);
}

test('loadCheckpoint: returns null when the file does not exist', () => {
  const checkpointPath = tempCheckpointPath();
  assert.equal(loadCheckpoint(checkpointPath), null);
});

test('saveCheckpoint then loadCheckpoint: round-trips the replay ID', () => {
  const checkpointPath = tempCheckpointPath();
  const replayId = Buffer.from('some-replay-id-bytes');

  saveCheckpoint(replayId, checkpointPath);
  const loaded = loadCheckpoint(checkpointPath);

  assert.ok(loaded);
  assert.equal(loaded?.replayId, replayId.toString('base64'));
  assert.ok(loaded?.capturedAt);

  fs.rmSync(checkpointPath, { force: true });
});

test('saveCheckpoint: overwrites a previous checkpoint at the same path', () => {
  const checkpointPath = tempCheckpointPath();

  saveCheckpoint(Buffer.from('first'), checkpointPath);
  saveCheckpoint(Buffer.from('second'), checkpointPath);

  const loaded = loadCheckpoint(checkpointPath);
  assert.equal(loaded?.replayId, Buffer.from('second').toString('base64'));

  fs.rmSync(checkpointPath, { force: true });
});
