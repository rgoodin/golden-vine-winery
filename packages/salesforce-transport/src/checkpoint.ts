import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

const DEFAULT_CHECKPOINT_PATH = path.join(process.cwd(), '.checkpoint.json');

export interface Checkpoint {
  replayId: string; // base64-encoded, since Pub/Sub replay IDs are raw bytes
  capturedAt: string; // ISO timestamp, for visibility only
}

/**
 * Loads the persisted Pub/Sub replay checkpoint, if one exists.
 *
 * `checkpointPath` defaults to `<cwd>/.checkpoint.json` - relative to
 * wherever the *consuming* process runs, not to this package - so a
 * service that runs from its own directory (the normal case) needs no
 * configuration to get its own checkpoint file. Pass an explicit path
 * only if a consumer genuinely needs more than one.
 *
 * Captures the replay ID of the most recent event that was successfully
 * passed to `onEvent` in `subscribe()` - NOT necessarily "successfully
 * processed end-to-end by the caller." Whether the checkpoint should
 * mean "last received" vs. "last successfully processed" was an open
 * design question investigated in the golden-vine-winery repository
 * this package was extracted from - see its
 * `docs/devex/friction-log.md` before changing this semantic.
 */
export function loadCheckpoint(checkpointPath: string = DEFAULT_CHECKPOINT_PATH): Checkpoint | null {
  if (!existsSync(checkpointPath)) {
    return null;
  }
  return JSON.parse(readFileSync(checkpointPath, 'utf8')) as Checkpoint;
}

export function saveCheckpoint(replayId: Buffer, checkpointPath: string = DEFAULT_CHECKPOINT_PATH): void {
  const checkpoint: Checkpoint = {
    replayId: replayId.toString('base64'),
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}
