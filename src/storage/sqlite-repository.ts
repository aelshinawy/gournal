import type { DatabaseSync } from 'node:sqlite';
import { hasLineBreak, mergeRefs, newId, normalizeTags, summaryLength, MAX_SUMMARY } from '../core';
import type { Entry, EntryPatch, Kind, NewEntryInput, Ref } from '../core';
import type { EntryRepository, ListQuery } from '../core/repository';
import { backupDbIfNeeded } from './backup';
import type { Config } from './config';
import { hydrateRows, replaceRefs as replaceRefRows, replaceTags as replaceTagRows } from './entry-rows';
import type { Row } from './entry-rows';

export class AmbiguousIdError extends Error {
  constructor(input: string) {
    super(`Id "${input}" matches more than one entry; use more characters.`);
    this.name = 'AmbiguousIdError';
  }
}

const MIN_SUFFIX = 6;
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
  const aliasProject = (p: string): string => (Object.hasOwn(config.projectAliases, p) ? config.projectAliases[p] : p);

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
    const rows = db.prepare('SELECT id FROM entries WHERE upper(substr(id, -length(?1))) = upper(?1) LIMIT 2').all(input) as { id: string }[];
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
    db.prepare("UPDATE entries SET status = 'resolved', resolved_at = ?, resolved_by_entry_id = ?, updated_at = ? WHERE id = ?")
      .run(now, byEntryId, now, id);
    return id;
  }

  function parseTime(value: string, what: string): number {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error(`Invalid ${what}: "${value}"`);
    return ms;
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
        // An edit must move updated_at past imported_at, even within the same millisecond: the bundle merge calls an entry pristine when they are equal.
        sets.push('updated_at = max(?, updated_at + 1)'); vals.push(now);
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
        // Same rule as update: a restored entry must not look pristine.
        db.prepare('UPDATE entries SET deleted_at = NULL, updated_at = max(?, updated_at + 1) WHERE id = ? AND deleted_at IS NOT NULL').run(Date.now(), id);
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

    list(q: ListQuery = {}) {
      const where: string[] = [];
      const vals: (string | number)[] = [];
      if (!q.includeDeleted) where.push('deleted_at IS NULL');
      if (q.project !== undefined) { where.push('project = ?'); vals.push(aliasProject(q.project)); }
      for (const tag of q.tags ?? []) {
        // Same normalization as add. A ticket-shaped tag is stored as a ref, so no tag can match it.
        const [norm] = normalize([tag]).tags;
        if (norm === undefined) { where.push('0'); continue; }
        where.push('EXISTS (SELECT 1 FROM entry_tags t WHERE t.entry_id = entries.id AND t.tag = ?)');
        vals.push(norm);
      }
      if (q.from !== undefined) { where.push('created_at >= ?'); vals.push(parseTime(q.from, 'from')); }
      if (q.to !== undefined) { where.push('created_at <= ?'); vals.push(parseTime(q.to, 'to')); }
      let sql = `SELECT * FROM entries${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`;
      if (q.limit !== undefined && Number.isInteger(q.limit) && q.limit > 0) { sql += ' LIMIT ?'; vals.push(q.limit); }
      return hydrate(db.prepare(sql).all(...vals) as unknown as Row[]);
    },

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
