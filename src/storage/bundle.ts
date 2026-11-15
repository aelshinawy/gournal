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
}

export interface ImportResult { inserted: number; updated: number; skipped: number }

export function exportBundle(db: DatabaseSync, config: Config): Bundle {
  const rows = db.prepare('SELECT * FROM entries ORDER BY created_at, id').all() as unknown as Row[];
  return {
    format: 'gournal-bundle',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    deviceId: config.deviceId,
    entries: hydrateRows(db, rows),
  };
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const KINDS = ['done', 'blocker', 'next'];
const STATUSES = ['open', 'resolved'];
const SOURCES = ['cli', 'mcp', 'migration'];
const REF_TYPES = ['pr', 'jira', 'commit', 'url'];

const isStr = (v: unknown): v is string => typeof v === 'string';
const isIso = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
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
  if (!Array.isArray(o.tags) || !o.tags.every(isStr)) return 'tags';
  if (!Array.isArray(o.refs) || !o.refs.every((r) => {
    if (typeof r !== 'object' || r === null) return false;
    const x = r as Record<string, unknown>;
    return isStr(x.type) && REF_TYPES.includes(x.type) && isStr(x.value) && (x.repo === undefined || isStr(x.repo));
  })) return 'refs';
  return null;
}

const ms = (v: string | null): number | null => (v === null ? null : Date.parse(v));

/** Merge a bundle into the database by id. The later updatedAt wins. Values are written as given. */
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

  const result: ImportResult = { inserted: 0, updated: 0, skipped: 0 };
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
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}
