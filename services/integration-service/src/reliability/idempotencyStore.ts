import * as path from 'path';

/**
 * Minimal typing for node:sqlite (experimental as of Node 22, not yet
 * covered by this project's pinned @types/node) - just the surface this
 * module actually uses. See scripts/lib/idempotencyStore.ts (FL-0019)
 * for why this shim exists instead of a typed import.
 */
interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase };

/**
 * Tier 1 durable ownership (docs/decisions/0005-external-side-effect-reliability-contract.md).
 *
 * This is the production form of the mechanism validated experimentally
 * in scripts/lib/idempotencyStore.ts (OB-0017, OB-0021): a real
 * `PRIMARY KEY` constraint is the atomic gate deciding which caller owns
 * a business operation - never a prior `SELECT` (that race is exactly
 * why Candidate B was rejected - see the architecture spike, Candidate
 * B). Two differences from the experimental version, deliberate, not
 * accidental:
 *
 * - A single module-level connection, opened once and reused, rather
 *   than opened per call - appropriate for a long-running service
 *   process, not a short-lived script.
 * - Only `acquire` and `complete` are exposed. The experimental
 *   `reclaim()` (staleness-based recovery, OB-0020/OB-0021) is
 *   deliberately NOT carried over here - ADR 0005's Tier 1 baseline, as
 *   scoped for this Enablement round, covers normal processing and
 *   concurrent initial-processing protection only. Recovering a stale
 *   operation is explicitly the next Enablement step, not this one.
 */

export type OperationStatus = 'in_flight' | 'completed';

export interface OperationRecord {
  businessOperationId: string;
  status: OperationStatus;
  incidentSysId: string | null;
  incidentNumber: string | null;
  acquiredAt: string;
  completedAt: string | null;
}

const DB_PATH = path.join(__dirname, '..', '..', '.idempotency.sqlite');

let db: SqliteDatabase | null = null;

function getStore(): SqliteDatabase {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS business_operations (
        business_operation_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        incident_sys_id TEXT,
        incident_number TEXT,
        acquired_at TEXT NOT NULL,
        completed_at TEXT
      )
    `);
  }
  return db;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR' &&
    /UNIQUE constraint failed/.test(err.message)
  );
}

/**
 * Atomic create-if-absent for a business operation. Returns `true` only
 * for the single caller whose `INSERT` actually lands - the database
 * engine's `PRIMARY KEY` constraint decides, not a prior read. Returns
 * `false` for every other caller, whether the existing row is
 * `in_flight` (someone else owns it right now, or a prior attempt
 * crashed and never finished - this function does not and cannot
 * distinguish those, by design; see OB-0018) or `completed` (the
 * operation already happened).
 */
export function acquireOperation(businessOperationId: string): boolean {
  try {
    getStore()
      .prepare('INSERT INTO business_operations (business_operation_id, status, acquired_at) VALUES (?, ?, ?)')
      .run(businessOperationId, 'in_flight', new Date().toISOString());
    return true;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Records that the external side effect for this business operation
 * happened and durably identifies it. Only the caller that received
 * `true` from `acquireOperation` for this ID should ever call this.
 */
export function completeOperation(businessOperationId: string, incidentSysId: string, incidentNumber: string): void {
  getStore()
    .prepare(
      'UPDATE business_operations SET status = ?, incident_sys_id = ?, incident_number = ?, completed_at = ? WHERE business_operation_id = ?'
    )
    .run('completed', incidentSysId, incidentNumber, new Date().toISOString(), businessOperationId);
}

/** Read-only lookup, for logging/observability when `acquireOperation` returns `false`. */
export function getOperation(businessOperationId: string): OperationRecord | null {
  const row = getStore()
    .prepare('SELECT * FROM business_operations WHERE business_operation_id = ?')
    .get(businessOperationId);
  if (!row) return null;
  return {
    businessOperationId: row.business_operation_id as string,
    status: row.status as OperationStatus,
    incidentSysId: (row.incident_sys_id as string | null) ?? null,
    incidentNumber: (row.incident_number as string | null) ?? null,
    acquiredAt: row.acquired_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}
