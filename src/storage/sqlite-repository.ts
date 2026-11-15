import type { DatabaseSync } from 'node:sqlite';
import { hasLineBreak, mergeRefs, newId, normalizeTags, resolveProjectAlias, resolveQuery, summaryLength, MAX_SUMMARY } from '../core';
import type { Entry, EntryPatch, Kind, NewEntryInput, Query, Ref } from '../core';
import type { EntryRepository } from '../core';
import { backupDbIfNeeded } from './backup';
import { searchIndexLive } from './schema';
import { ftsMatchExpression, likePattern } from './search';
import type { Config } from '../core';
import { hydrateRows, replaceRefs as replaceRefRows, replaceTags as replaceTagRows } from './entry-rows';
import type { Row } from './entry-rows';

export class AmbiguousIdError extends Error {
  constructor(input: string) {
    super(`Id "${input}" matches more than one entry; use more characters.`);
    this.name = 'AmbiguousIdError';
  }
}

const MIN_SUFFIX = 6;
/**
 * SQL for every write that edits a live entry. It takes the current time as its one parameter and keeps
 * updated_at strictly rising, even within one millisecond. The bundle merge calls an entry pristine when
 * updated_at equals imported_at, so an edit must never land on that value.
 */
const BUMP_UPDATED_AT = 'updated_at = max(?, updated_at + 1)';
let backupWarned = false;

function checkSummary(summary: string): void {
  if (summary.trim().length === 0) throw new Error('summary is empty');
  if (summaryLength(summary) > MAX_SUMMARY) throw new Error(`summary is over ${MAX_SUMMARY} characters`);
  if (hasLineBreak(summary)) throw new Error('summary must be one line');
}

const isActionable = (kind: string | null): boolean => kind === 'blocker' || kind === 'next';
const noEntry = (input: string): Error => new Error(`No entry with id "${input}"`);

export function createRepository(db: DatabaseSync, config: Config, dbPath: string): EntryRepository {
  const normalize = (tags: string[]) => normalizeTags(tags, config.tagAliases, { ticketPrefixes: config.ticketPrefixes });
  const aliasProject = (p: string): string => resolveProjectAlias(p, config.projectAliases);

  // True while this repository holds an open transaction. Nested writes then join it.
  let inTransaction = false;

  function write<T>(fn: () => T): T {
    if (inTransaction) return fn();
    try {
      backupDbIfNeeded(db, dbPath);
    } catch (err) {
      // A failed backup never blocks logging. Warn once per process.
      if (!backupWarned) {
        backupWarned = true;
        process.stderr.write(`gournal: daily backup failed: ${(err as Error).message}\n`);
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
  }

  const hydrate = (rows: Row[]): Entry[] => hydrateRows(db, rows);

  function load(id: string): Entry {
    const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error(`No entry with id "${id}"`);
    return hydrate([row])[0];
  }

  /** Full id, or a unique suffix of 6 or more chars. Null if nothing matches. */
  function findId(input: string): string | null {
    const exact = db.prepare('SELECT id FROM entries WHERE id = ?').get(input) as { id: string } | undefined;
    if (exact) return exact.id;
    if (input.length < MIN_SUFFIX) return null;
    const rows = db.prepare('SELECT id FROM entries WHERE upper(substr(id, -length(?))) = upper(?) LIMIT 2').all(input, input) as { id: string }[];
    if (rows.length > 1) throw new AmbiguousIdError(input);
    return rows.length === 1 ? rows[0].id : null;
  }

  function requireId(input: string): string {
    const id = findId(input);
    if (!id) throw noEntry(input);
    return id;
  }

  const replaceTags = (id: string, tags: string[]): void => replaceTagRows(db, id, tags);
  const replaceRefs = (id: string, refs: Ref[]): void => replaceRefRows(db, id, refs);

  /** Mark one open blocker or next as resolved. Runs inside a write. */
  function resolveInTx(inputId: string, byEntryId: string | null, now: number): string {
    const id = requireId(inputId);
    const row = db.prepare('SELECT kind, status FROM entries WHERE id = ?').get(id) as { kind: string | null; status: string | null };
    if (!isActionable(row.kind) || row.status !== 'open') throw new Error('only an open blocker or next can be resolved');
    db.prepare(`UPDATE entries SET status = 'resolved', resolved_at = ?, resolved_by_entry_id = ?, ${BUMP_UPDATED_AT} WHERE id = ?`)
      .run(now, byEntryId, now, id);
    return id;
  }

  function parseTime(value: string, what: string): number {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error(`Invalid ${what}: "${value}"`);
    return ms;
  }

  /** One WHERE clause for find and the counts. Order and limit come back for find only. */
  function buildWhere(q: Query): { where: string; vals: (string | number)[]; order: 'ASC' | 'DESC'; limit?: number } {
    const r = resolveQuery(q, config.projectAliases);
    const where: string[] = [];
    const vals: (string | number)[] = [];
    if (!r.includeDeleted) where.push('entries.deleted_at IS NULL');
    if (r.projects) {
      where.push(`entries.project COLLATE NOCASE IN (${r.projects.map(() => '?').join(', ')})`);
      vals.push(...r.projects);
    }
    if (r.repo !== undefined) { where.push('entries.repo = ? COLLATE NOCASE'); vals.push(r.repo); }
    if (r.kind) { where.push(`entries.kind IN (${r.kind.map(() => '?').join(', ')})`); vals.push(...r.kind); }
    if (r.status !== undefined) { where.push('entries.status = ?'); vals.push(r.status); }
    if (r.source !== undefined) { where.push('entries.source = ?'); vals.push(r.source); }
    for (const tag of r.tags ?? []) {
      // Same normalization as add. A ticket-shaped tag is stored as a ref, so no tag can match it.
      const [norm] = normalize([tag]).tags;
      if (norm === undefined) { where.push('0'); continue; }
      where.push('EXISTS (SELECT 1 FROM entry_tags ft WHERE ft.entry_id = entries.id AND ft.tag = ?)');
      vals.push(norm);
    }
    if (r.fromMs !== undefined) { where.push('entries.created_at >= ?'); vals.push(r.fromMs); }
    if (r.toMs !== undefined) { where.push('entries.created_at <= ?'); vals.push(r.toMs); }
    if (r.terms && r.terms.length === 0) {
      where.push('0');
    } else if (r.terms) {
      if (searchIndexLive(db)) {
        const expr = ftsMatchExpression(r.terms);
        if (expr === '') where.push('0');
        else { where.push('entries.rowid IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)'); vals.push(expr); }
      } else {
        for (const term of r.terms) {
          where.push("(entries.summary || char(10) || coalesce(entries.details, '')) LIKE ? ESCAPE '\\'");
          vals.push(likePattern(term));
        }
      }
    }
    return { where: where.length ? where.join(' AND ') : '1', vals, order: r.order === 'desc' ? 'DESC' : 'ASC', limit: r.limit };
  }

  return {
    transaction: write,

    add(input) {
      checkSummary(input.summary);
      return write(() => {
        const now = Date.now();
        const createdAt = input.createdAt !== undefined ? parseTime(input.createdAt, 'createdAt') : now;
        const { tags, refs: tagRefs } = normalize(input.tags ?? []);
        const refs = mergeRefs(tagRefs, input.refs ?? []);
        const kind: Kind = input.kind ?? 'done';
        const id = newId(createdAt);
        db.prepare(`INSERT INTO entries (id, created_at, updated_at, device_id, summary, details, kind, status,
            project, repo, branch, source, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, createdAt, now, config.deviceId, input.summary, input.details ?? null, kind,
            isActionable(kind) ? 'open' : null, aliasProject(input.project), input.repo ?? null,
            input.branch ?? null, input.source, input.agent ?? null);
        replaceTags(id, tags);
        replaceRefs(id, refs);
        // Dedupe by the resolved id: a full id and its suffix are one target.
        for (const target of new Set((input.resolves ?? []).map(requireId))) resolveInTx(target, id, now);
        return load(id);
      });
    },

    get(idOrSuffix) {
      const id = findId(idOrSuffix);
      return id ? load(id) : null;
    },

    update(inputId, patch: EntryPatch) {
      if (patch.summary !== undefined) checkSummary(patch.summary);
      return write(() => {
        const id = requireId(inputId);
        const now = Date.now();
        const cur = load(id);
        const sets: string[] = [];
        const vals: (string | number | null)[] = [];
        const set = (col: string, v: string | number | null) => { sets.push(`${col} = ?`); vals.push(v); };
        if (patch.summary !== undefined) set('summary', patch.summary);
        if (patch.details !== undefined) set('details', patch.details);
        if (patch.project !== undefined) set('project', aliasProject(patch.project));
        if (patch.repo !== undefined) set('repo', patch.repo);
        if (patch.branch !== undefined) set('branch', patch.branch);
        if (patch.kind !== undefined && patch.kind !== cur.kind) {
          set('kind', patch.kind);
          set('status', isActionable(patch.kind) ? 'open' : null);
          set('resolved_at', null);
          set('resolved_by_entry_id', null);
        }
        sets.push(BUMP_UPDATED_AT); vals.push(now);
        db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
        if (patch.tags !== undefined || patch.refs !== undefined) {
          const norm = patch.tags !== undefined ? normalize(patch.tags) : { tags: cur.tags, refs: [] as Ref[] };
          if (patch.tags !== undefined) replaceTags(id, norm.tags);
          // Refs are additive: a tag edit never drops a reference.
          replaceRefs(id, mergeRefs(patch.refs ?? cur.refs, norm.refs));
        }
        return load(id);
      });
    },

    softDelete(inputId) {
      return write(() => {
        const id = requireId(inputId);
        const now = Date.now();
        db.prepare('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, id);
        return load(id);
      });
    },

    restore(inputId) {
      return write(() => {
        const id = requireId(inputId);
        db.prepare(`UPDATE entries SET deleted_at = NULL, ${BUMP_UPDATED_AT} WHERE id = ? AND deleted_at IS NOT NULL`).run(Date.now(), id);
        return load(id);
      });
    },

    resolve(inputId, byEntryId) {
      return write(() => {
        const by = byEntryId !== undefined ? requireId(byEntryId) : null;
        return load(resolveInTx(inputId, by, Date.now()));
      });
    },

    softDeleteAll() {
      return write(() => {
        const now = Date.now();
        return Number(db.prepare('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL').run(now, now).changes);
      });
    },

    latestForDevice() {
      const row = db.prepare('SELECT * FROM entries WHERE deleted_at IS NULL AND device_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
        .get(config.deviceId) as Row | undefined;
      return row ? hydrate([row])[0] : null;
    },

    find(q: Query = {}) {
      const { where, vals, order, limit } = buildWhere(q);
      let sql = `SELECT entries.* FROM entries WHERE ${where} ORDER BY created_at ${order}, id ${order}`;
      if (limit !== undefined) { sql += ' LIMIT ?'; vals.push(limit); }
      return hydrate(db.prepare(sql).all(...vals) as unknown as Row[]);
    },

    tagCounts(q: Query = {}) {
      const { where, vals } = buildWhere(q);
      return db.prepare(`SELECT t.tag AS tag, COUNT(DISTINCT entries.id) AS count FROM entries
        JOIN entry_tags t ON t.entry_id = entries.id WHERE ${where} GROUP BY t.tag ORDER BY count DESC, t.tag ASC`)
        .all(...vals) as { tag: string; count: number }[];
    },

    projectCounts(q: Query = {}) {
      const { where, vals } = buildWhere(q);
      return db.prepare(`SELECT project, COUNT(*) AS count FROM entries WHERE ${where}
        GROUP BY project ORDER BY count DESC, project ASC`).all(...vals) as { project: string; count: number }[];
    },

    searchMode: () => (searchIndexLive(db) ? 'fts' : 'like'),

    allTags() {
      return (db.prepare(`SELECT DISTINCT t.tag FROM entry_tags t JOIN entries e ON e.id = t.entry_id
        WHERE e.deleted_at IS NULL ORDER BY t.tag`).all() as { tag: string }[]).map((r) => r.tag);
    },

    getState(key) {
      const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string | null } | undefined;
      return row?.value ?? null;
    },

    setState(key, value) {
      db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    },
  };
}
