import * as path from 'path';

/**
 * Minimal typing for node:sqlite (experimental as of Node 22, not yet
 * covered by this project's pinned @types/node) - just the surface this
 * module actually uses. See scripts/lib/idempotencyStore.ts (FL-0019) in
 * services/integration-service for why this shim exists instead of a
 * typed import.
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
 * Tier 1 durable ownership
 * (docs/decisions/0005-external-side-effect-reliability-contract.md in
 * the golden-vine-winery repo this package originated from).
 *
 * This is the production form of the mechanism validated experimentally
 * in golden-vine-winery's scripts/lib/idempotencyStore.ts (OB-0017,
 * OB-0021): a real `PRIMARY KEY` constraint is the atomic gate deciding
 * which caller owns a business operation - never a prior `SELECT` (that
 * race is exactly why Candidate B was rejected - see the architecture
 * spike, Candidate B). Two differences from that experimental version,
 * deliberate, not accidental:
 *
 * - A single module-level connection, opened once and reused, rather
 *   than opened per call - appropriate for a long-running service
 *   process, not a short-lived script.
 * - Only ownership/state primitives live here: `acquireOperation`,
 *   `reclaimOperation`, `completeOperation`, `getOperation`. Target
 *   reconciliation (deciding what "stale" should actually resolve to
 *   against a specific target) deliberately does not live here - this
 *   module knows nothing about ServiceNow, Incidents, or any other
 *   target; it only knows which business operations are in flight,
 *   stale, or completed. That boundary is what makes this package
 *   reusable across targets and, eventually, across integrations -
 *   see docs/golden-path/0002-design-principles.md ("hide accidental
 *   complexity, not legitimate decisions") in golden-vine-winery for
 *   why that boundary was drawn here specifically.
 *
 * The database file lives at `<cwd>/.idempotency.sqlite` - relative to
 * wherever the *consuming* process runs, not to this package's own
 * install location. A service that runs from its own directory (as
 * every current caller does) gets its own store for free, with no
 * required configuration.
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

const DB_PATH = path.join(process.cwd(), '.idempotency.sqlite');

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

/**
 * Atomic, conditional reclaim of a stale `in_flight` operation - the
 * production form of the mechanism validated experimentally in
 * golden-vine-winery's `scripts/lib/idempotencyStore.ts` (OB-0020,
 * OB-0021). A caller reclaims only if the row is still `in_flight` AND
 * its `acquired_at` is older than `staleAfterMs`; both conditions are
 * evaluated inside the single `UPDATE`'s `WHERE` clause, so the database
 * engine - not a prior read - decides whether this call's reclaim took
 * effect (`changes > 0`). Same "constraint decides, not a read"
 * principle as `acquireOperation`, applied to recovery instead of first
 * creation.
 *
 * `staleAfterMs` is supplied by the caller, not defaulted here - this
 * module has no opinion on how long is "genuinely abandoned" for any
 * particular target or business operation; that judgment belongs with
 * whatever invokes recovery (a business/customer risk decision, not a
 * platform one - see docs/devex/phase-2-observation-review.md Finding
 * 11 in golden-vine-winery).
 *
 * A row with no matching `in_flight`/stale state - because it was never
 * acquired, is still fresh, or is already `completed` - reclaims
 * nothing (`false`, zero rows changed). Reclaim can therefore never
 * create a new operation or touch a healthy one; it only ever acts on a
 * row that already exists and already looks abandoned under the
 * caller's chosen policy.
 *
 * "Stale" here means "eligible for recovery under this policy," not
 * "proven dead." A slow-but-still-running original owner can be
 * reclaimed by this same mechanism while its own external call is
 * genuinely still in flight - confirmed unsafe with real independent
 * processes (OB-0022), and NOT solved by this function or anything that
 * calls it.
 */
export function reclaimOperation(businessOperationId: string, staleAfterMs: number): boolean {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
  const result = getStore()
    .prepare(
      'UPDATE business_operations SET acquired_at = ? WHERE business_operation_id = ? AND status = ? AND acquired_at < ?'
    )
    .run(new Date().toISOString(), businessOperationId, 'in_flight', cutoff);
  return Number(result.changes) > 0;
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
