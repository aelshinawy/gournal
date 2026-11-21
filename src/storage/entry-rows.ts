import type { DatabaseSync } from 'node:sqlite';
import type { Entry, Ref } from '../core';

export interface Row {
  id: string; created_at: number; updated_at: number; deleted_at: number | null; device_id: string;
  summary: string; details: string | null; kind: string | null; status: string | null;
  resolved_at: number | null; resolved_by_entry_id: string | null; project: string | null;
  repo: string | null; branch: string | null; source: string | null; agent: string | null;
}

const CHUNK = 500;

export const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Split a list into parts of at most CHUNK items, so an IN list stays under the SQLite variable limit. */
export function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** Parse an ISO time input to epoch ms. A bad value throws a message that names the field. */
export function parseTime(value: string, what: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid ${what}: "${value}"`);
  return ms;
}

export const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

/** Load tags and refs for the rows and build full entries. */
export function hydrateRows(db: DatabaseSync, rows: Row[]): Entry[] {
  const tags = new Map<string, string[]>();
  const refs = new Map<string, Ref[]>();
  for (const part of chunks(rows)) {
    const ids = part.map((r) => r.id);
    const holes = marks(ids.length);
    for (const t of db.prepare(`SELECT entry_id, tag FROM entry_tags WHERE entry_id IN (${holes}) ORDER BY rowid`).all(...ids) as { entry_id: string; tag: string }[]) {
      (tags.get(t.entry_id) ?? tags.set(t.entry_id, []).get(t.entry_id)!).push(t.tag);
    }
    for (const r of db.prepare(`SELECT entry_id, type, value, repo FROM entry_refs WHERE entry_id IN (${holes}) ORDER BY rowid`).all(...ids) as { entry_id: string; type: string; value: string; repo: string | null }[]) {
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

export function replaceTags(db: DatabaseSync, id: string, tags: string[]): void {
  db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id);
  const ins = db.prepare('INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)');
  for (const t of tags) ins.run(id, t);
}

export function replaceRefs(db: DatabaseSync, id: string, refs: Ref[]): void {
  db.prepare('DELETE FROM entry_refs WHERE entry_id = ?').run(id);
  const ins = db.prepare('INSERT INTO entry_refs (entry_id, type, value, repo) VALUES (?, ?, ?, ?)');
  for (const r of refs) ins.run(id, r.type, r.value, r.repo ?? null);
}
