import type { DatabaseSync } from 'node:sqlite';
import { summaryLength, MAX_SUMMARY } from '../core';
import { newId } from '../core';
import type { Activity, Entry } from '../core';
import type { Config } from '../core';
import { createActivityRepository, payloadText, rowToActivity } from './activity-repository';
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
  /** GitHub activity, live and deleted. Optional on import, so bundles from before Phase 3 still load. Links are not exported. */
  activity?: Activity[];
}

export interface LegacyMapRow {
  legacyIndex: number;
  timestamp: string;
  messageHash: string;
  occurrence: number;
  entryId: string;
  /** When the legacy import made the entry (ISO), or null when unknown. Optional on import. */
  importedAt?: string | null;
}

export interface ImportResult {
  inserted: number; updated: number; skipped: number; deduplicated: number;
  /** Present only when the bundle carries at least one activity row. */
  activity?: { inserted: number; updated: number; skipped: number };
}

export function exportBundle(db: DatabaseSync, config: Config): Bundle {
  // One read transaction gives a consistent snapshot of entries, tags, and refs.
  db.exec('BEGIN');
  try {
    const rows = db.prepare('SELECT * FROM entries ORDER BY created_at, id').all() as unknown as Row[];
    const activity = (db.prepare('SELECT * FROM activity ORDER BY occurred_at, id').all() as unknown as Parameters<typeof rowToActivity>[0][]).map(rowToActivity);
    return {
      format: 'gournal-bundle',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      deviceId: config.deviceId,
      entries: hydrateRows(db, rows),
      activity,
      legacyMap: (db.prepare('SELECT legacy_index, timestamp, message_hash, occurrence, entry_id, imported_at FROM legacy_map ORDER BY legacy_index, timestamp, occurrence').all() as
        { legacy_index: number; timestamp: string; message_hash: string; occurrence: number; entry_id: string; imported_at: number | null }[])
        .map((r) => ({ legacyIndex: r.legacy_index, timestamp: r.timestamp, messageHash: r.message_hash, occurrence: r.occurrence, entryId: r.entry_id,
          importedAt: r.imported_at === null ? null : new Date(r.imported_at).toISOString() })),
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

const ACTIVITY_TYPES = ['commit', 'pr_opened', 'pr_merged', 'review'];

/** Return the name of the first invalid field, or null when the activity row is valid. */
function invalidActivityField(a: unknown): string | null {
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return 'activity';
  const o = a as Record<string, unknown>;
  if (!isStr(o.id) || !ULID.test(o.id)) return 'id';
  if (!isIso(o.createdAt)) return 'createdAt';
  if (!isIso(o.updatedAt)) return 'updatedAt';
  if (!isNullOr(o.deletedAt, isIso)) return 'deletedAt';
  if (!isStr(o.deviceId)) return 'deviceId';
  if (!isStr(o.type) || !ACTIVITY_TYPES.includes(o.type)) return 'type';
  if (!isIso(o.occurredAt)) return 'occurredAt';
  if (!isStr(o.repo)) return 'repo';
  if (!isNullOr(o.branch, isStr)) return 'branch';
  if (!isStr(o.externalId)) return 'externalId';
  if (!isNullOr(o.title, isStr)) return 'title';
  if (!isNullOr(o.url, isStr)) return 'url';
  if (!isNullOr(o.pr, (v) => Number.isInteger(v))) return 'pr';
  if (typeof o.payload !== 'object' || o.payload === null || Array.isArray(o.payload)) return 'payload';
  return null;
}

const invalidMapRow = (r: unknown): boolean => {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return true;
  const o = r as Record<string, unknown>;
  return !(Number.isInteger(o.legacyIndex) && (o.legacyIndex as number) >= 0 && isStr(o.timestamp) && isStr(o.messageHash)
    && Number.isInteger(o.occurrence) && (o.occurrence as number) >= 0 && isStr(o.entryId)
    && (o.importedAt === undefined || isNullOr(o.importedAt, isIso)));
};

const ms = (v: string | null): number | null => (v === null ? null : Date.parse(v));

/**
 * Merge a bundle into the database by id. The later updatedAt wins. Values are written as given.
 * Then merge its legacy map. If one legacy line points to two entries (one made by the local
 * import, one from the bundle), one copy wins and the other is soft deleted. The user's version
 * wins over a raw re-import (see mergeLegacyMap).
 */
export function importBundle(db: DatabaseSync, bundle: unknown, config?: Config): ImportResult {
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

  if (b.activity !== undefined && !Array.isArray(b.activity)) throw new Error('Bundle activity is invalid');
  const acts = (b.activity ?? []) as unknown[];
  acts.forEach((a, i) => {
    const bad = invalidActivityField(a);
    if (bad) throw new Error(`Bundle activity ${i} is invalid: ${bad}`);
  });

  const result: ImportResult = { inserted: 0, updated: 0, skipped: 0, deduplicated: 0 };
  const changedEntries: string[] = [];
  const changedActivity: string[] = [];
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
      changedEntries.push(e.id);
      replaceTags(db, e.id, e.tags);
      replaceRefs(db, e.id, e.refs);
    }
    mergeLegacyMap(db, map as LegacyMapRow[], result);
    if (acts.length > 0) result.activity = mergeActivity(db, acts as Activity[], changedActivity);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
  // Links are derived data. A relink failure never fails the import.
  if (config && (changedEntries.length > 0 || changedActivity.length > 0)) {
    try {
      // The import command has taken its own backup, and an empty database must not take the day's slot.
      const activity = createActivityRepository(db, config, '', { backup: false });
      activity.relinkEntries(changedEntries);
      activity.relinkActivity(changedActivity);
    } catch (err) {
      process.stderr.write(`gournal: relink after import failed (${(err as Error).message})\n`);
    }
  }
  return result;
}

/**
 * Upsert activity by (type, repo, externalId). A match keeps the local id, and the later updatedAt wins.
 * Runs inside the import transaction. Returns the counts and collects the local ids that changed.
 */
function mergeActivity(db: DatabaseSync, list: Activity[], changed: string[]): { inserted: number; updated: number; skipped: number } {
  const counts = { inserted: 0, updated: 0, skipped: 0 };
  const find = db.prepare('SELECT id, updated_at FROM activity WHERE type = ? AND repo = ? AND external_id = ?');
  const idTaken = db.prepare('SELECT 1 AS x FROM activity WHERE id = ?');
  const insert = db.prepare(`INSERT INTO activity (id, created_at, updated_at, deleted_at, device_id, type, occurred_at, repo, branch,
    external_id, title, url, captured_by, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'github', ?)`);
  const update = db.prepare(`UPDATE activity SET updated_at = ?, deleted_at = ?, device_id = ?, occurred_at = ?, branch = ?, title = ?, url = ?, payload = ?
    WHERE id = ?`);
  for (const a of list) {
    const existing = find.get(a.type, a.repo, a.externalId) as { id: string; updated_at: number } | undefined;
    const updatedAt = Date.parse(a.updatedAt);
    if (existing && existing.updated_at >= updatedAt) { counts.skipped++; continue; }
    const payload = payloadText(a.payload, a.pr);
    if (existing) {
      update.run(updatedAt, ms(a.deletedAt), a.deviceId, Date.parse(a.occurredAt), a.branch, a.title, a.url, payload, existing.id);
      counts.updated++;
      changed.push(existing.id);
    } else {
      const id = idTaken.get(a.id) ? newId() : a.id;
      insert.run(id, Date.parse(a.createdAt), updatedAt, ms(a.deletedAt), a.deviceId, a.type, Date.parse(a.occurredAt), a.repo, a.branch,
        a.externalId, a.title, a.url, payload);
      counts.inserted++;
      changed.push(id);
    }
  }
  return counts;
}

function mergeLegacyMap(db: DatabaseSync, map: LegacyMapRow[], result: ImportResult): void {
  const entry = db.prepare('SELECT updated_at, deleted_at FROM entries WHERE id = ?');
  const local = db.prepare('SELECT entry_id, imported_at FROM legacy_map WHERE timestamp = ? AND message_hash = ? AND occurrence = ?');
  const insert = db.prepare('INSERT INTO legacy_map (legacy_index, timestamp, message_hash, occurrence, entry_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)');
  const repoint = db.prepare('UPDATE legacy_map SET entry_id = ?, imported_at = ? WHERE timestamp = ? AND message_hash = ? AND occurrence = ?');
  const hide = db.prepare('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL');
  type E = { updated_at: number; deleted_at: number | null };
  // Pristine: live, and unchanged since the legacy import made it. An unknown import time is not pristine.
  const pristine = (e: E, importedAt: number | null): boolean => e.deleted_at === null && importedAt !== null && e.updated_at === importedAt;
  for (const r of map) {
    const theirs = entry.get(r.entryId) as E | undefined;
    if (!theirs) continue;
    const theirImported = r.importedAt == null ? null : Date.parse(r.importedAt);
    const known = local.get(r.timestamp, r.messageHash, r.occurrence) as { entry_id: string; imported_at: number | null } | undefined;
    if (!known) { insert.run(r.legacyIndex, r.timestamp, r.messageHash, r.occurrence, r.entryId, theirImported); continue; }
    if (known.entry_id === r.entryId) continue;
    const mine = entry.get(known.entry_id) as E | undefined;
    if (!mine) { repoint.run(r.entryId, theirImported, r.timestamp, r.messageHash, r.occurrence); continue; }
    // A raw re-import never hides the user's edited or deleted copy. When both copies are
    // alike (both pristine, or neither), the later updatedAt wins, then the smaller id, so every device picks the same one.
    const minePristine = pristine(mine, known.imported_at);
    const theirsPristine = pristine(theirs, theirImported);
    const smallerTheirs = r.entryId < known.entry_id;
    let keepTheirs: boolean;
    if (minePristine !== theirsPristine) keepTheirs = minePristine;
    else if (minePristine) keepTheirs = smallerTheirs;
    else keepTheirs = theirs.updated_at > mine.updated_at || (theirs.updated_at === mine.updated_at && smallerTheirs);
    const [winner, loser] = keepTheirs ? [r.entryId, known.entry_id] : [known.entry_id, r.entryId];
    // The winner keeps its state, live or deleted. A live loser is soft deleted, never erased.
    const now = Date.now();
    hide.run(now, now, loser);
    if (keepTheirs) repoint.run(winner, theirImported, r.timestamp, r.messageHash, r.occurrence);
    result.deduplicated++;
  }
}
