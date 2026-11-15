import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository, AmbiguousIdError } from '../../src/storage/sqlite-repository';
import type { EntryRepository } from '../../src/core/repository';

let home: string; let db: DatabaseSync; let config: Config; let repo: EntryRepository;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-repo-'));
  const dbPath = path.join(home, 'gournal.db');
  db = openDb(dbPath);
  config = loadConfig(home);
  config.ticketPrefixes = ['sbdc'];
  repo = createRepository(db, config, dbPath);
});
afterEach(() => { db.close(); fs.rmSync(home, { recursive: true, force: true }); });

const base = { project: 'p', source: 'cli' as const };

test('add stores a v2 entry with defaults', () => {
  const e = repo.add({ summary: 'Fixed it', project: 'api', source: 'cli', tags: ['Bug', 'sbdc-1'] });
  expect(e).toMatchObject({ summary: 'Fixed it', kind: 'done', status: null, project: 'api', tags: ['bug'],
    refs: [{ type: 'jira', value: 'SBDC-1' }], deviceId: config.deviceId, deletedAt: null });
  expect(repo.get(e.id)).toEqual(e);
});
test('project aliases apply on write', () => {
  config.projectAliases['collection-app-v2'] = 'collection-app';
  expect(repo.add({ summary: 's', project: 'collection-app-v2', source: 'cli' }).project).toBe('collection-app');
});
test('blocker starts open and resolves', () => {
  const b = repo.add({ summary: 'Waiting on infra', kind: 'blocker', project: 'p', source: 'mcp' });
  expect(b.status).toBe('open');
  const d = repo.add({ summary: 'Got access', project: 'p', source: 'mcp', resolves: [b.id] });
  expect(repo.get(b.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: d.id });
});
test('resolve refuses a done entry', () => {
  const e = repo.add({ summary: 's', ...base });
  expect(() => repo.resolve(e.id)).toThrow('only an open blocker or next can be resolved');
});
test('resolve on an unknown id throws', () => {
  expect(() => repo.resolve('NOPE-NOPE')).toThrow('No entry with id "NOPE-NOPE"');
});
test('add with a bad resolves id writes nothing', () => {
  const done = repo.add({ summary: 'done one', ...base });
  const b = repo.add({ summary: 'blocked', kind: 'blocker', ...base });
  expect(() => repo.add({ summary: 'x', ...base, resolves: [b.id, done.id] })).toThrow('only an open blocker or next');
  expect(repo.list()).toHaveLength(2);
  expect(repo.get(b.id)?.status).toBe('open');
});
test('softDelete hides and restore returns', () => {
  const e = repo.add({ summary: 's', ...base });
  repo.softDelete(e.id);
  expect(repo.list()).toEqual([]);
  expect(repo.list({ includeDeleted: true })[0].deletedAt).not.toBeNull();
  expect(repo.restore(e.id).deletedAt).toBeNull();
});
test('softDeleteAll hides every entry and returns the count', () => {
  repo.add({ summary: 'a', ...base });
  repo.add({ summary: 'b', ...base });
  expect(repo.softDeleteAll()).toBe(2);
  expect(repo.list()).toEqual([]);
  expect(repo.softDeleteAll()).toBe(0);
});
test('update changes fields and updated_at', () => {
  const e = repo.add({ summary: 's', ...base });
  const u = repo.update(e.id, { summary: 't', tags: ['X'] });
  expect(u).toMatchObject({ summary: 't', tags: ['x'] });
  expect(u.updatedAt >= e.updatedAt).toBe(true);
});
test('update on an unknown id throws', () => {
  expect(() => repo.update('missing-id', { summary: 'x' })).toThrow('No entry with id "missing-id"');
});
test('get accepts a unique suffix', () => {
  const e = repo.add({ summary: 's', ...base });
  expect(repo.get(e.id.slice(-8))?.id).toBe(e.id);
});
test('get returns null for a short non-id and for no match', () => {
  const e = repo.add({ summary: 's', ...base });
  expect(repo.get(e.id.slice(-5))).toBeNull();
  expect(repo.get('ZZZZZZZZ')).toBeNull();
});
test('get throws AmbiguousIdError when a suffix matches two entries', () => {
  const ins = (id: string) => db.prepare('INSERT INTO entries (id, created_at, updated_at, device_id, summary) VALUES (?, 1, 1, ?, ?)').run(id, 'D', 's');
  ins('AAAAAAAAAA-SHARED1');
  ins('BBBBBBBBBB-SHARED1');
  expect(() => repo.get('SHARED1')).toThrow(AmbiguousIdError);
  expect(() => repo.get('SHARED1')).toThrow('Id "SHARED1" matches more than one entry; use more characters.');
});
test('list filters by project, tags, and bounds, oldest first', () => {
  const a = repo.add({ summary: 'a', project: 'a', source: 'cli', tags: ['x'], createdAt: '2026-07-03T10:00:00.000Z' });
  const b = repo.add({ summary: 'b', project: 'a', source: 'cli', tags: [], createdAt: '2026-07-01T10:00:00.000Z' });
  const c = repo.add({ summary: 'c', project: 'b', source: 'cli', tags: ['x'], createdAt: '2026-07-02T10:00:00.000Z' });
  expect(repo.list().map((e) => e.id)).toEqual([b.id, c.id, a.id]);
  expect(repo.list({ project: 'a' }).map((e) => e.id)).toEqual([b.id, a.id]);
  expect(repo.list({ tags: ['x'] }).map((e) => e.id)).toEqual([c.id, a.id]);
  expect(repo.list({ from: '2026-07-02T00:00:00.000Z' })).toHaveLength(2);
  expect(repo.list({ to: '2026-07-01T23:59:59.999Z' }).map((e) => e.id)).toEqual([b.id]);
  expect(repo.list({ limit: 1 }).map((e) => e.id)).toEqual([b.id]);
});
test('latestForDevice skips deleted entries and other devices', () => {
  const a = repo.add({ summary: 'a', ...base });
  const b = repo.add({ summary: 'b', ...base });
  repo.softDelete(b.id);
  expect(repo.latestForDevice()?.id).toBe(a.id);
  db.prepare('INSERT INTO entries (id, created_at, updated_at, device_id, summary) VALUES (?, ?, ?, ?, ?)')
    .run('ZZZZZZZZZZZZZZZZZZZZZZZZZZ', Date.now() + 10_000, Date.now() + 10_000, 'other-device', 'foreign');
  expect(repo.latestForDevice()?.id).toBe(a.id);
});
test('FTS index follows updates', () => {
  const e = repo.add({ summary: 'alpha', ...base });
  repo.update(e.id, { summary: 'beta' });
  expect(db.prepare("SELECT count(*) c FROM entries_fts WHERE entries_fts MATCH 'beta'").get()).toEqual({ c: 1 });
});
test('allTags lists tags of live entries', () => {
  repo.add({ summary: 'a', ...base, tags: ['b', 'a'] });
  const gone = repo.add({ summary: 'c', ...base, tags: ['z'] });
  repo.softDelete(gone.id);
  expect(repo.allTags()).toEqual(['a', 'b']);
});
test('state round-trips', () => {
  expect(repo.getState('k')).toBeNull();
  repo.setState('k', 'v1');
  repo.setState('k', 'v2');
  expect(repo.getState('k')).toBe('v2');
});
