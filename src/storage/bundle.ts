import type { DatabaseSync } from 'node:sqlite';
import { summaryLength, MAX_SUMMARY } from '../core';
import type { Entry } from '../core';
import type { Config } from './config';
import { hydrateRows, replaceRefs, replaceTags } from './entry-rows';
import type { Row } from './entry-rows';

export interface Bundle {
  format: 'gournal-bundle';
  schemaVersion: 1;
  exportedAt: string;
  deviceId: string;
  entries: Entry[];
  /** Which legacy line each migrated entry came from. Optional on import, so older bundles still load. */
  legacyMap?: LegacyMapRow[];
}

export interface LegacyMapRow {
  legacyIndex: number;
  timestamp: string;
  messageHash: string;
  occurrence: number;
  entryId: string;
}

export interface ImportResult { inserted: number; updated: number; skipped: number; deduplicated: number }

export function exportBundle(db: DatabaseSync, config: Config): Bundle {
  // One read transaction gives a consistent snapshot of entries, tags, and refs.
  db.exec('BEGIN');
  try {
    const rows = db.prepare('SELECT * FROM entries ORDER BY created_at, id').all() as unknown as Row[];
    return {
      format: 'gournal-bundle',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      deviceId: config.deviceId,
      entries: hydrateRows(db, rows),
      legacyMap: (db.prepare('SELECT legacy_index, timestamp, message_hash, occurrence, entry_id FROM legacy_map ORDER BY legacy_index, timestamp, occurrence').all() as
        { legacy_index: number; timestamp: string; message_hash: string; occurrence: number; entry_id: string }[])
        .map((r) => ({ legacyIndex: r.legacy_index, timestamp: r.timestamp, messageHash: r.message_hash, occurrence: r.occurrence, entryId: r.entry_id })),
    };
  } finally {
    try { db.exec('COMMIT'); } catch { /* ignore */ }
  }
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const KINDS = ['done', 'blocker', 'next'];
const STATUSES = ['open', 'resolved'];
const SOURCES = ['cli', 'mcp', 'migration'];
const REF_TYPES = ['pr', 'jira', 'commit', 'url'];

const isStr = (v: unknown): v is string => typeof v === 'string';
// Strict: only canonical UTC ISO strings (as toISOString writes them) are valid.
const isIso = (v: unknown): v is string => {
  if (!isStr(v)) return false;
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
};
const isNullOr = (v: unknown, ok: (x: unknown) => boolean): boolean => v === null || ok(v);

/** Return the name of the first invalid field, or null when the entry is valid. */
function invalidField(e: unknown): string | null {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return 'entry';
  const o = e as Record<string, unknown>;
  if (!isStr(o.id) || !ULID.test(o.id)) return 'id';
  if (!isIso(o.createdAt)) return 'createdAt';
  if (!isIso(o.updatedAt)) return 'updatedAt';
  if (!isNullOr(o.deletedAt, isIso)) return 'deletedAt';
  if (!isStr(o.deviceId)) return 'deviceId';
  if (!isStr(o.summary) || o.summary.length === 0 || summaryLength(o.summary) > MAX_SUMMARY) return 'summary';
  if (!isNullOr(o.details, isStr)) return 'details';
  if (!isStr(o.kind) || !KINDS.includes(o.kind)) return 'kind';
  if (!isNullOr(o.status, (v) => isStr(v) && STATUSES.includes(v))) return 'status';
  if (!isNullOr(o.resolvedAt, isIso)) return 'resolvedAt';
  if (!isNullOr(o.resolvedByEntryId, isStr)) return 'resolvedByEntryId';
  if (!isStr(o.project)) return 'project';
  if (!isNullOr(o.repo, isStr)) return 'repo';
  if (!isNullOr(o.branch, isStr)) return 'branch';
  if (!isStr(o.source) || !SOURCES.includes(o.source)) return 'source';
  if (!isNullOr(o.agent, isStr)) return 'agent';
  if (!Array.isArray(o.tags) || !o.tags.every(isStr) || new Set(o.tags).size !== o.tags.length) return 'tags';
  if (!Array.isArray(o.refs) || !o.refs.every((r) => {
    if (typeof r !== 'object' || r === null) return false;
    const x = r as Record<string, unknown>;
    return isStr(x.type) && REF_TYPES.includes(x.type) && isStr(x.value) && (x.repo === undefined || isStr(x.repo));
  })) return 'refs';
  return null;
}

const invalidMapRow = (r: unknown): boolean => {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return true;
  const o = r as Record<string, unknown>;
  return !(Number.isInteger(o.legacyIndex) && (o.legacyIndex as number) >= 0 && isStr(o.timestamp) && isStr(o.messageHash)
    && Number.isInteger(o.occurrence) && (o.occurrence as number) >= 0 && isStr(o.entryId));
};

const ms = (v: string | null): number | null => (v === null ? null : Date.parse(v));

/**
 * Merge a bundle into the database by id. The later updatedAt wins. Values are written as given.
 * Then merge its legacy map. If one legacy line points to two live entries (one made by the
 * local import, one from the bundle), the later updatedAt stays live and the other is soft deleted.
 */
export function importBundle(db: DatabaseSync, bundle: unknown): ImportResult {
  const b = bundle as Partial<Bundle> | null;
  if (typeof b !== 'object' || b === null || b.format !== 'gournal-bundle' || b.schemaVersion !== 1 || !Array.isArray(b.entries)) {
    throw new Error('Not a gournal bundle');
  }
  const entries = b.entries as unknown[];
  entries.forEach((e, i) => {
    const bad = invalidField(e);
    if (bad) throw new Error(`Bundle entry ${i} is invalid: ${bad}`);
  });

  if (b.legacyMap !== undefined && !Array.isArray(b.legacyMap)) throw new Error('Bundle legacyMap is invalid');
  const map = (b.legacyMap ?? []) as unknown[];
  map.forEach((r, i) => {
    if (invalidMapRow(r)) throw new Error(`Bundle legacyMap row ${i} is invalid`);
  });

  const result: ImportResult = { inserted: 0, updated: 0, skipped: 0, deduplicated: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const find = db.prepare('SELECT updated_at FROM entries WHERE id = ?');
    const insert = db.prepare(`INSERT INTO entries (id, created_at, updated_at, deleted_at, device_id, summary, details, kind, status,
      resolved_at, resolved_by_entry_id, project, repo, branch, source, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const update = db.prepare(`UPDATE entries SET created_at = ?, updated_at = ?, deleted_at = ?, device_id = ?, summary = ?, details = ?,
      kind = ?, status = ?, resolved_at = ?, resolved_by_entry_id = ?, project = ?, repo = ?, branch = ?, source = ?, agent = ? WHERE id = ?`);
    for (const e of entries as Entry[]) {
      const existing = find.get(e.id) as { updated_at: number } | undefined;
      const updatedAt = Date.parse(e.updatedAt);
      if (existing && existing.updated_at >= updatedAt) { result.skipped++; continue; }
      const cols = [ms(e.createdAt), updatedAt, ms(e.deletedAt), e.deviceId, e.summary, e.details, e.kind, e.status,
        ms(e.resolvedAt), e.resolvedByEntryId, e.project, e.repo, e.branch, e.source, e.agent] as (string | number | null)[];
      if (existing) { update.run(...cols, e.id); result.updated++; } else { insert.run(e.id, ...cols); result.inserted++; }
      replaceTags(db, e.id, e.tags);
      replaceRefs(db, e.id, e.refs);
    }
    mergeLegacyMap(db, map as LegacyMapRow[], result);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

function mergeLegacyMap(db: DatabaseSync, map: LegacyMapRow[], result: ImportResult): void {
  const entry = db.prepare('SELECT updated_at, deleted_at FROM entries WHERE id = ?');
  const local = db.prepare('SELECT entry_id FROM legacy_map WHERE timestamp = ? AND message_hash = ? AND occurrence = ?');
  const insert = db.prepare('INSERT INTO legacy_map (legacy_index, timestamp, message_hash, occurrence, entry_id) VALUES (?, ?, ?, ?, ?)');
  const repoint = db.prepare('UPDATE legacy_map SET entry_id = ? WHERE timestamp = ? AND message_hash = ? AND occurrence = ?');
  const hide = db.prepare('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL');
  type E = { updated_at: number; deleted_at: number | null };
  for (const r of map) {
    const theirs = entry.get(r.entryId) as E | undefined;
    if (!theirs) continue;
    const known = local.get(r.timestamp, r.messageHash, r.occurrence) as { entry_id: string } | undefined;
    if (!known) { insert.run(r.legacyIndex, r.timestamp, r.messageHash, r.occurrence, r.entryId); continue; }
    if (known.entry_id === r.entryId) continue;
    const mine = entry.get(known.entry_id) as E | undefined;
    if (!mine) { repoint.run(r.entryId, r.timestamp, r.messageHash, r.occurrence); continue; }
    // Only two live entries are duplicates. A deleted one is the user's choice, so leave both alone.
    if (mine.deleted_at !== null || theirs.deleted_at !== null) continue;
    // The later updatedAt survives. On a tie the smaller id survives, so every device picks the same one.
    const keepTheirs = theirs.updated_at > mine.updated_at || (theirs.updated_at === mine.updated_at && r.entryId < known.entry_id);
    const [winner, loser] = keepTheirs ? [r.entryId, known.entry_id] : [known.entry_id, r.entryId];
    const now = Date.now();
    hide.run(now, now, loser);
    if (keepTheirs) repoint.run(winner, r.timestamp, r.messageHash, r.occurrence);
    result.deduplicated++;
  }
}
