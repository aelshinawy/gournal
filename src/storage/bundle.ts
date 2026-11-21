import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { summaryLength, MAX_SUMMARY, stripControl, cleanDetails, cleanOpt, cleanProject, cleanRefs, EntrySchema, ActivitySchema } from '../core';
import { newId } from '../core';
import type { Activity, Entry } from '../core';
import type { Config } from '../core';
import { createWriter } from './writer';
import { immediate } from './transaction';
import { createActivityRepository } from './activity-repository';
import { payloadText, rowToActivity } from './activity-rows';
import { hydrateRows, replaceRefs, replaceTags } from './entry-rows';
import type { Row } from './entry-rows';

export interface Bundle {
  format: 'gournal-bundle';
  schemaVersion: 1;
  exportedAt: string;
  deviceId: string;
  entries: Entry[];
  /** GitHub activity, live and deleted. Optional on import, so bundles from before Phase 3 still load. Links are not exported. */
  activity?: Activity[];
}

export interface ImportResult {
  inserted: number; updated: number; skipped: number;
  /** Present only when the bundle carries at least one activity row. */
  activity?: { inserted: number; updated: number; skipped: number };
}

export function exportBundle(db: DatabaseSync, config: Config): Bundle {
  // One read transaction gives a consistent snapshot.
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
    };
  } finally {
    try { db.exec('COMMIT'); } catch { /* ignore */ }
  }
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
// Only canonical UTC ISO strings, as toISOString writes them.
const Iso = z.string().refine((v) => { const t = Date.parse(v); return !Number.isNaN(t) && new Date(t).toISOString() === v; });
// Number.isInteger, not .int(): .int() also rejects unsafe integers, which the format accepts.
const Int = z.number().refine(Number.isInteger);

// test/fixtures/bundles pins what import accepts.
const BundleEntrySchema = EntrySchema.extend({
  id: z.string().regex(ULID),
  createdAt: Iso,
  updatedAt: Iso,
  deletedAt: Iso.nullable(),
  summary: z.string().refine((s) => s.length > 0 && summaryLength(s) <= MAX_SUMMARY),
  resolvedAt: Iso.nullable(),
  tags: z.array(z.string()).refine((t) => new Set(t).size === t.length),
});

// Import writes capturedBy as the literal 'github'.
const BundleActivitySchema = ActivitySchema.omit({ capturedBy: true }).extend({
  id: z.string().regex(ULID),
  createdAt: Iso,
  updatedAt: Iso,
  deletedAt: Iso.nullable(),
  occurredAt: Iso,
  pr: Int.nullable(),
});
type BundleActivity = z.infer<typeof BundleActivitySchema>;

/** A failure names the first bad field, or `top` when the item is not an object. */
function parseItems<T>(items: unknown[], schema: z.ZodType<T>, fail: (i: number, field: string) => Error, top: string): T[] {
  return items.map((item, i) => {
    const parsed = schema.safeParse(item);
    if (!parsed.success) throw fail(i, String(parsed.error.issues[0].path[0] ?? top));
    return parsed.data;
  });
}

/** Only an empty summary fails, as it does in the repository. */
function cleanEntry(e: Entry, i: number): Entry {
  const summary = stripControl(e.summary);
  if (summary.trim().length === 0) throw new Error(`Bundle entry ${i} is invalid: summary`);
  return {
    ...e,
    summary,
    details: cleanDetails(e.details) ?? null,
    project: cleanProject(e.project),
    repo: cleanOpt(e.repo) ?? null,
    branch: cleanOpt(e.branch) ?? null,
    agent: cleanOpt(e.agent) ?? null,
    tags: [...new Set(e.tags.map(stripControl).filter((t) => t !== ''))],
    refs: cleanRefs(e.refs),
  };
}

const ms = (v: string | null): number | null => (v === null ? null : Date.parse(v));

/**
 * Merge a bundle into the database by id. The later updatedAt wins. Values are written as given.
 * An old bundle can carry a legacyMap key. Import ignores it.
 */
export function importBundle(db: DatabaseSync, bundle: unknown, config?: Config): ImportResult {
  const b = bundle as Partial<Bundle> | null;
  if (typeof b !== 'object' || b === null || b.format !== 'gournal-bundle' || b.schemaVersion !== 1 || !Array.isArray(b.entries)) {
    throw new Error('Not a gournal bundle');
  }
  // Strip control characters on write, as the repository does. A stripped field is never rejected.
  const entries = parseItems(b.entries, BundleEntrySchema, (i, f) => new Error(`Bundle entry ${i} is invalid: ${f}`), 'entry').map((e, i) => cleanEntry(e, i));

  if (b.activity !== undefined && !Array.isArray(b.activity)) throw new Error('Bundle activity is invalid');
  const acts = parseItems(b.activity ?? [],BundleActivitySchema, (i, f) => new Error(`Bundle activity ${i} is invalid: ${f}`), 'activity');

  const result: ImportResult = { inserted: 0, updated: 0, skipped: 0 };
  const changedEntries: string[] = [];
  const changedActivity: string[] = [];
  immediate(db, () => {
    const find = db.prepare('SELECT updated_at FROM entries WHERE id = ?');
    const insert = db.prepare(`INSERT INTO entries (id, created_at, updated_at, deleted_at, device_id, summary, details, kind, status,
      resolved_at, resolved_by_entry_id, project, repo, branch, source, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const update = db.prepare(`UPDATE entries SET created_at = ?, updated_at = ?, deleted_at = ?, device_id = ?, summary = ?, details = ?,
      kind = ?, status = ?, resolved_at = ?, resolved_by_entry_id = ?, project = ?, repo = ?, branch = ?, source = ?, agent = ? WHERE id = ?`);
    for (const e of entries) {
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
    if (acts.length > 0) result.activity = mergeActivity(db, acts, changedActivity);
  });
  // Links are derived data. A relink failure never fails the import.
  if (config && (changedEntries.length > 0 || changedActivity.length > 0)) {
    try {
      // The import command has taken its own backup, and an empty database must not take the day's slot.
      const activity = createActivityRepository(db, config, null, createWriter(db, null));
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
function mergeActivity(db: DatabaseSync, list: BundleActivity[], changed: string[]): { inserted: number; updated: number; skipped: number } {
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
