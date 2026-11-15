import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

// Timestamp columns are INTEGER epoch milliseconds. Tables are STRICT, so ISO text is rejected.
// Repository code converts ISO strings to and from ms at its boundary.
// legacy_map.timestamp stays TEXT: it holds the original ISO string from entries.json.
// activity.payload is TEXT (JSON). activity.repo and external_id default to '' so UNIQUE dedupes.
// entry_tags and entry_refs are attributes of their entry and are replaced as a whole when the
// entry changes; the entry's updated_at is the sync marker.
// Full-text search is not part of any migration. node:sqlite can be built without FTS5 (the official
// Linux Node builds are), and a migration that needs FTS5 would fail there. See ensureSearchIndex.
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  device_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  kind TEXT,
  status TEXT,
  resolved_at INTEGER,
  resolved_by_entry_id TEXT,
  project TEXT,
  repo TEXT,
  branch TEXT,
  source TEXT,
  agent TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag);

CREATE TABLE IF NOT EXISTS entry_refs (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  repo TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_entry_refs_entry ON entry_refs(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_refs_lookup ON entry_refs(type, value);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  repo TEXT NOT NULL DEFAULT '',
  branch TEXT,
  external_id TEXT NOT NULL DEFAULT '',
  title TEXT,
  url TEXT,
  captured_by TEXT,
  payload TEXT,
  UNIQUE (type, repo, external_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity(occurred_at);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  device_id TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_links_entry ON links(entry_id);
CREATE INDEX IF NOT EXISTS idx_links_activity ON links(activity_id);

CREATE TABLE IF NOT EXISTS legacy_map (
  legacy_index INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  UNIQUE (timestamp, message_hash, occurrence)
) STRICT;

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
) STRICT;
`;

// v2: legacy_map.imported_at is the updated_at (ms) of the entry when the legacy import made it.
// An entry is pristine while its updated_at still equals imported_at. NULL means unknown, so not pristine.
const SCHEMA_V2 = `
ALTER TABLE legacy_map ADD COLUMN imported_at INTEGER;
`;

const MIGRATIONS: Record<number, string> = { 1: SCHEMA_V1, 2: SCHEMA_V2 };

function readVersion(db: DatabaseSync): number {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get();
  if (!t) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  return row.v ?? 0;
}

function checkNotNewer(current: number): void {
  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${current} is newer than this Gournal supports (${SCHEMA_VERSION}).`);
  }
}

export function migrateSchema(db: DatabaseSync): void {
  const before = readVersion(db);
  checkNotNewer(before);
  if (before === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = readVersion(db);
    checkNotNewer(current);
    for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
      db.exec(MIGRATIONS[v]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

// ---- Optional full-text index ----
// entries_fts is an index over entries, not data. No feature reads it today. It exists only when this
// node:sqlite build has FTS5. Databases made before this change already have it, and those stay valid.

// GOURNAL_DISABLE_FTS5=1 acts as a build without FTS5. Tests use it. Only hasFts5 reads it.
export const DISABLE_FTS5_ENV = 'GOURNAL_DISABLE_FTS5';

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
