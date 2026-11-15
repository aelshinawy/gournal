import type { DatabaseSync } from 'node:sqlite';
import { backupDbIfNeeded } from './backup';

/**
 * SQL for every write that edits a live row. It takes the current time as its one parameter and keeps
 * updated_at strictly rising, even within one millisecond. The bundle merge calls an entry pristine when
 * updated_at equals imported_at, so an edit must never land on that value.
 */
export const BUMP_UPDATED_AT = 'updated_at = max(?, updated_at + 1)';

export interface Writer {
  /**
   * Run fn in one BEGIN IMMEDIATE transaction. A call inside an open transaction of this writer joins it.
   * `backup: false` skips the daily backup for this call.
   */
  write<T>(fn: () => T, opts?: { backup?: boolean }): T;
}

let backupWarned = false;

/**
 * One writer per connection. The entry and activity repositories share it, so a write of one joins
 * the open transaction of the other. With a null dbPath, the writer never takes the daily backup.
 */
export function createWriter(db: DatabaseSync, dbPath: string | null): Writer {
  let inTransaction = false;
  return {
    write<T>(fn: () => T, opts: { backup?: boolean } = {}): T {
      if (inTransaction) return fn();
      if (dbPath !== null && opts.backup !== false) {
        try {
          backupDbIfNeeded(db, dbPath);
        } catch (err) {
          // A failed backup never blocks logging. Warn once per process.
          if (!backupWarned) {
            backupWarned = true;
            process.stderr.write(`gournal: daily backup failed: ${(err as Error).message}\n`);
          }
        }
      }
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        inTransaction = false;
      }
    },
  };
}
