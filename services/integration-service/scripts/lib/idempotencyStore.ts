import * as path from 'path';

/**
 * Minimal typing for node:sqlite (experimental as of Node 22, not yet
 * covered by the project's pinned @types/node) - just the surface this
 * investigation prototype actually uses.
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
 * Investigation-only prototype of an integration-owned durable idempotency
 * store (Candidate C in docs/architecture/0001-reliability-architecture-spike.md).
 *
 * Deliberately NOT wired into src/ - this is not the chosen architecture,
 * just the smallest thing capable of a genuine atomic create-if-absent, to
 * test whether that primitive can establish the same invariant ServiceNow
 * itself could not be verified to enforce (FL-0018, OB-0016).
 *
 * Uses node:sqlite (built in, no new dependency) with a PRIMARY KEY
 * constraint as the atomic gate. Deliberately does NOT do
 * "SELECT ... then INSERT if absent" - that would just relocate the same
 * lookup-before-create race this project already knows is unsound
 * (docs/architecture/0001-reliability-architecture-spike.md Candidate B).
 * Instead every caller attempts the INSERT directly; the database engine's
 * own constraint, not application code, decides the single winner.
 */

export type IdempotencyStatus = 'in_flight' | 'completed';

export interface IdempotencyRecord {
  businessOperationId: string;
  status: IdempotencyStatus;
  incidentSysId: string | null;
  incidentNumber: string | null;
  acquiredAt: string;
  completedAt: string | null;
}

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', '.idempotency-experiment.sqlite');

export function openStore(dbPath: string = DEFAULT_DB_PATH): SqliteDatabase {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      business_operation_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      incident_sys_id TEXT,
      incident_number TEXT,
      acquired_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
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
 * Atomic create-if-absent. Returns true only for the single caller whose
 * INSERT actually landed - the PRIMARY KEY constraint is the concurrency
 * control, not a prior read. Returns false for every other caller,
 * WITHOUT distinguishing whether the existing row is 'in_flight' (someone
 * else is genuinely mid-flight, or a prior attempt crashed and never
 * finished) or 'completed'. That non-distinction is deliberate - it is
 * exactly what the crash-gap experiment probes.
 */
export function acquire(db: SqliteDatabase, businessOperationId: string): boolean {
  try {
    db.prepare(
      'INSERT INTO idempotency_keys (business_operation_id, status, acquired_at) VALUES (?, ?, ?)'
    ).run(businessOperationId, 'in_flight', new Date().toISOString());
    return true;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return false;
    }
    throw err;
  }
}

export function markCompleted(
  db: SqliteDatabase,
  businessOperationId: string,
  incidentSysId: string,
  incidentNumber: string
): void {
  db.prepare(
    'UPDATE idempotency_keys SET status = ?, incident_sys_id = ?, incident_number = ?, completed_at = ? WHERE business_operation_id = ?'
  ).run('completed', incidentSysId, incidentNumber, new Date().toISOString(), businessOperationId);
}

export function getRecord(db: SqliteDatabase, businessOperationId: string): IdempotencyRecord | null {
  const row = db.prepare('SELECT * FROM idempotency_keys WHERE business_operation_id = ?').get(businessOperationId);
  if (!row) return null;
  return {
    businessOperationId: row.business_operation_id as string,
    status: row.status as IdempotencyStatus,
    incidentSysId: (row.incident_sys_id as string | null) ?? null,
    incidentNumber: (row.incident_number as string | null) ?? null,
    acquiredAt: row.acquired_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}
