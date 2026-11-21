import type { DatabaseSync } from 'node:sqlite';

/** Run fn in one BEGIN IMMEDIATE transaction. A throw rolls back and rethrows the original error. */
export function immediate<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    // A failed rollback must not hide the original error.
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}
