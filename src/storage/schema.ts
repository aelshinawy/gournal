import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

// Timestamp columns are INTEGER epoch milliseconds. Tables are STRICT, so ISO text is rejected.
// Repository code converts ISO strings to and from ms at its boundary.
// legacy_map.timestamp stays TEXT: it holds the original ISO string from entries.json.
// activity.payload is TEXT (JSON). activity.repo and external_id default to '' so UNIQUE dedupes.
// entry_tags and entry_refs are attributes of their entry and are replaced as a whole when the
// entry changes; the entry's updated_at is the sync marker.
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
