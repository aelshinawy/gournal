import type { DatabaseSync } from 'node:sqlite';
import { mergeRefs, newId, normalizeTags } from '../core';
import type { Entry, EntryPatch, Kind, NewEntryInput, Ref } from '../core';
import type { EntryRepository, ListQuery } from '../core/repository';
import { backupDbIfNeeded } from './backup';
import type { Config } from './config';

export class AmbiguousIdError extends Error {
  constructor(input: string) {
    super(`Id "${input}" matches more than one entry; use more characters.`);
    this.name = 'AmbiguousIdError';
  }
}

const MIN_SUFFIX = 6;
const CHUNK = 500;

interface Row {
  id: string; created_at: number; updated_at: number; deleted_at: number | null; device_id: string;
  summary: string; details: string | null; kind: string | null; status: string | null;
  resolved_at: number | null; resolved_by_entry_id: string | null; project: string | null;
  repo: string | null; branch: string | null; source: string | null; agent: string | null;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const isActionable = (kind: string | null): boolean => kind === 'blocker' || kind === 'next';
const noEntry = (input: string): Error => new Error(`No entry with id "${input}"`);

export function createRepository(db: DatabaseSync, config: Config, dbPath: string): EntryRepository {
  const normalize = (tags: string[]) => normalizeTags(tags, config.tagAliases, { ticketPrefixes: config.ticketPrefixes });
  const aliasProject = (p: string): string => (Object.hasOwn(config.projectAliases, p) ? config.projectAliases[p] : p);

  function write<T>(fn: () => T): T {
    backupDbIfNeeded(db, dbPath);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }

  function hydrate(rows: Row[]): Entry[] {
    const tags = new Map<string, string[]>();
    const refs = new Map<string, Ref[]>();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
      const marks = ids.map(() => '?').join(',');
      for (const t of db.prepare(`SELECT entry_id, tag FROM entry_tags WHERE entry_id IN (${marks}) ORDER BY rowid`).all(...ids) as { entry_id: string; tag: string }[]) {
        (tags.get(t.entry_id) ?? tags.set(t.entry_id, []).get(t.entry_id)!).push(t.tag);
      }
      for (const r of db.prepare(`SELECT entry_id, type, value, repo FROM entry_refs WHERE entry_id IN (${marks}) ORDER BY rowid`).all(...ids) as { entry_id: string; type: string; value: string; repo: string | null }[]) {
        const ref = { type: r.type, value: r.value, ...(r.repo !== null ? { repo: r.repo } : {}) } as Ref;
        (refs.get(r.entry_id) ?? refs.set(r.entry_id, []).get(r.entry_id)!).push(ref);
      }
    }
    return rows.map((r) => ({
      id: r.id,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      deletedAt: iso(r.deleted_at),
      deviceId: r.device_id,
      summary: r.summary,
      details: r.details,
      kind: r.kind as Entry['kind'],
      status: r.status as Entry['status'],
      resolvedAt: iso(r.resolved_at),
      resolvedByEntryId: r.resolved_by_entry_id,
      project: r.project as string,
      repo: r.repo,
      branch: r.branch,
      source: r.source as Entry['source'],
      agent: r.agent,
      tags: tags.get(r.id) ?? [],
      refs: refs.get(r.id) ?? [],
    }));
  }

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

  function replaceTags(id: string, tags: string[]): void {
    db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id);
    const ins = db.prepare('INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)');
    for (const t of tags) ins.run(id, t);
  }

  function replaceRefs(id: string, refs: Ref[]): void {
    db.prepare('DELETE FROM entry_refs WHERE entry_id = ?').run(id);
    const ins = db.prepare('INSERT INTO entry_refs (entry_id, type, value, repo) VALUES (?, ?, ?, ?)');
    for (const r of refs) ins.run(id, r.type, r.value, r.repo ?? null);
  }

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
    add(input) {
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
        for (const target of input.resolves ?? []) resolveInTx(target, id, now);
        return load(id);
      });
    },

    get(idOrSuffix) {
      const id = findId(idOrSuffix);
      return id ? load(id) : null;
    },

    update(inputId, patch: EntryPatch) {
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
        set('updated_at', now);
        db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
        if (patch.tags !== undefined || patch.refs !== undefined) {
          const norm = patch.tags !== undefined ? normalize(patch.tags) : { tags: cur.tags, refs: [] as Ref[] };
          if (patch.tags !== undefined) replaceTags(id, norm.tags);
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
        db.prepare('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL').run(Date.now(), id);
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
        where.push('EXISTS (SELECT 1 FROM entry_tags t WHERE t.entry_id = entries.id AND t.tag = ?)');
        vals.push(tag.trim().toLowerCase());
      }
      if (q.from !== undefined) { where.push('created_at >= ?'); vals.push(parseTime(q.from, 'from')); }
      if (q.to !== undefined) { where.push('created_at <= ?'); vals.push(parseTime(q.to, 'to')); }
      let sql = `SELECT * FROM entries${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`;
      if (q.limit !== undefined) { sql += ' LIMIT ?'; vals.push(q.limit); }
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
