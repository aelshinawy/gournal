import type { DatabaseSync } from 'node:sqlite';

// ---- Optional full-text index ----
// entries_fts is an index over entries, not data. No feature reads it today. It exists only when this
// node:sqlite build has FTS5. Databases made before this change already have it, and those stay valid.

// GOURNAL_DISABLE_FTS5=1 acts as a build without FTS5. Tests use it. Only hasFts5 reads it.
const DISABLE_FTS5_ENV = 'GOURNAL_DISABLE_FTS5';

// A guarded probe, not pragma_compile_options: it tests the capability itself (FTS5 can also come from
// a loaded extension). The probe table is in the temp schema, so it takes no lock on the database file.
// Only "no such module" means "no FTS5". Any other error (locked, corrupt, out of memory) is rethrown.
export function hasFts5(db: DatabaseSync): boolean {
  if (process.env[DISABLE_FTS5_ENV] === '1') return false;
  try {
    db.exec('CREATE VIRTUAL TABLE temp.gournal_fts5_probe USING fts5(a)');
  } catch (err) {
    if (/no such module/i.test((err as Error)?.message ?? '')) return false;
    throw err;
  }
  try { db.exec('DROP TABLE temp.gournal_fts5_probe'); } catch { /* ignore */ }
  return true;
}

const FTS_TRIGGERS = ['entries_fts_ad', 'entries_fts_ai', 'entries_fts_au'];

const FTS_DDL = `
-- External-content FTS. It links to entries through the implicit rowid.
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  summary, details, content='entries', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, summary, details) VALUES (new.rowid, new.summary, new.details);
END;
CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, summary, details) VALUES ('delete', old.rowid, old.summary, old.details);
END;
CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, summary, details) VALUES ('delete', old.rowid, old.summary, old.details);
  INSERT INTO entries_fts(rowid, summary, details) VALUES (new.rowid, new.summary, new.details);
END;
`;

interface SearchIndexState { table: boolean; triggers: string[] }

// Reads sqlite_master only, so it works without the fts5 module even when entries_fts exists.
function readSearchIndexState(db: DatabaseSync): SearchIndexState {
  const names = ['entries_fts', ...FTS_TRIGGERS];
  const rows = db.prepare(
    `SELECT type, name FROM sqlite_master WHERE name IN (${names.map(() => '?').join(', ')})`
  ).all(...names) as { type: string; name: string }[];
  return {
    table: rows.some((r) => r.type === 'table' && r.name === 'entries_fts'),
    triggers: rows.filter((r) => r.type === 'trigger').map((r) => r.name),
  };
}

const fts5Support = new WeakMap<DatabaseSync, boolean>();

/**
 * True when full-text search can answer queries on this connection: this build has FTS5, the
 * entries_fts table exists, and all three triggers exist (so the index is current).
 * It caches the FTS5 probe per connection and reads sqlite_master on every call.
 */
export function searchIndexLive(db: DatabaseSync): boolean {
  let supported = fts5Support.get(db);
  if (supported === undefined) { supported = hasFts5(db); fts5Support.set(db, supported); }
  if (!supported) return false;
  const state = readSearchIndexState(db);
  return state.table && FTS_TRIGGERS.every((t) => state.triggers.includes(t));
}

let noticePrinted = false;
export function resetSearchIndexNotice(): void { noticePrinted = false; }

// Runs after migrateSchema.
// With FTS5 it creates the index and its triggers only for a database that has neither the table nor
// any trigger (new or never indexed), and builds the index from the existing rows.
// Without FTS5 it drops the triggers, so writes do not fail with "no such module". The table stays.
//
// The drop is one-way on purpose. A later opener WITH FTS5 must not recreate the triggers. Someone who
// runs mixed Node builds can have a long-lived process on a build without FTS5. If an FTS5 opener put
// the triggers back, every write in that process would fail with "no such module: fts5".
// A table without triggers therefore means "dropped on purpose", and it is left alone.
// The index is stale then, and text search uses LIKE instead. `gournal index rebuild` restores it.
//
// The one other state is stray: triggers without the table (for example, the table was dropped by hand).
// Every write fails while it lasts, so both modes drop the triggers. With FTS5 the index is then
// created as for a new database.
//
// Like migrateSchema, the up-to-date path takes no write lock. The check repeats inside the lock
// because other processes may open the same database at the same time.
export function ensureSearchIndex(db: DatabaseSync): void {
  const fts = hasFts5(db);
  // With FTS5, a missing table needs work: no triggers means a new database (create the index), and
  // triggers without the table are stray (drop them, then create the index).
  const needsWork = (s: SearchIndexState) => (fts ? !s.table : s.triggers.length > 0);
  if (!needsWork(readSearchIndexState(db))) return;
  db.exec('BEGIN IMMEDIATE');
  let dropped = false;
  try {
    const state = readSearchIndexState(db);
    if (needsWork(state)) {
      // Stray triggers (no table) make every write fail, in both modes. Drop them first.
      for (const t of state.triggers) db.exec(`DROP TRIGGER IF EXISTS "${t}"`);
      if (fts) {
        db.exec(FTS_DDL);
        db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')");
      } else {
        dropped = true;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
  if (dropped && !noticePrinted) {
    noticePrinted = true;
    process.stderr.write('gournal: full-text index disabled (this Node build has no FTS5)\n');
  }
}

/**
 * Drops and recreates the index and its triggers, then fills the index from all rows of entries.
 * It needs FTS5 and runs in one transaction. Callers take a backup first.
 */
export function rebuildSearchIndex(db: DatabaseSync): { indexed: number } {
  if (!hasFts5(db)) throw new Error('This Node build has no FTS5; the search index cannot be rebuilt.');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of FTS_TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS "${t}"`);
    db.exec('DROP TABLE IF EXISTS entries_fts');
    db.exec(FTS_DDL);
    db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')");
    const row = db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number };
    db.exec('COMMIT');
    return { indexed: row.n };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}
