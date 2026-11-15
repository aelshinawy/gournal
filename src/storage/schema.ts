import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

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
);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag);

CREATE TABLE IF NOT EXISTS entry_refs (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  repo TEXT
);
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
  repo TEXT,
  branch TEXT,
  external_id TEXT,
  title TEXT,
  url TEXT,
  captured_by TEXT,
  payload TEXT,
  UNIQUE (type, repo, external_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity(occurred_at);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  reason TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_links_entry ON links(entry_id);
CREATE INDEX IF NOT EXISTS idx_links_activity ON links(activity_id);

CREATE TABLE IF NOT EXISTS legacy_map (
  legacy_index INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  UNIQUE (timestamp, message_hash, occurrence)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

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

export function migrateSchema(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
    const current = row.v ?? 0;
    if (current > SCHEMA_VERSION) {
      throw new Error(`Database schema version ${current} is newer than this Gournal supports (${SCHEMA_VERSION}).`);
    }
    if (current < 1) {
      db.exec(SCHEMA_V1);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}
