import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

const CHECKPOINT_PATH = path.join(__dirname, '..', '..', '.checkpoint.json');

export interface Checkpoint {
  replayId: string; // base64-encoded, since Pub/Sub replay IDs are raw bytes
  capturedAt: string; // ISO timestamp, for visibility only
}

/**
 * Loads the persisted Pub/Sub replay checkpoint, if one exists.
 *
 * Experimental (Phase 3 Enablement, LL-0007): captures the replay ID of
 * the most recent event that was successfully passed to onEvent - NOT
 * necessarily "successfully delivered to ServiceNow." Whether the
 * checkpoint should mean "last received" vs. "last successfully
 * processed end-to-end" is an open design question - see
 * docs/devex/friction-log.md for this experiment's findings before
 * changing this semantic.
 */
export function loadCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) as Checkpoint;
}

export function saveCheckpoint(replayId: Buffer): void {
  const checkpoint: Checkpoint = {
    replayId: replayId.toString('base64'),
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}
