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
  db.prepare('UPDATE entries SET updated_at = 1 WHERE id = ?').run(e.id);
  const u = repo.update(e.id, { summary: 't', tags: ['X'] });
  expect(u).toMatchObject({ summary: 't', tags: ['x'] });
  expect(u.updatedAt > new Date(1).toISOString()).toBe(true);
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

const forceAmbiguous = () => {
  const ins = (id: string) => db.prepare('INSERT INTO entries (id, created_at, updated_at, device_id, summary) VALUES (?, 1, 1, ?, ?)').run(id, 'D', 's');
  ins('AAAAAAAAAA-SHARED1');
  ins('BBBBBBBBBB-SHARED1');
};

test('a backup failure does not block the write and warns once', () => {
  fs.writeFileSync(path.join(home, 'backups'), 'not a folder');
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const e1 = repo.add({ summary: 'one', ...base });
    repo.add({ summary: 'two', ...base });
    expect(repo.get(e1.id)).toEqual(e1);
    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('gournal: daily backup failed: '));
    expect(lines).toHaveLength(1);
  } finally { spy.mockRestore(); }
});
test('the first add on a fresh home creates one backup file', () => {
  repo.add({ summary: 'one', ...base });
  expect(fs.readdirSync(path.join(home, 'backups'))).toHaveLength(1);
});
test('update kind change resets status and resolved fields', () => {
  const e = repo.add({ summary: 's', ...base });
  const toBlocker = repo.update(e.id, { kind: 'blocker' });
  expect(toBlocker).toMatchObject({ kind: 'blocker', status: 'open' });
  const by = repo.add({ summary: 'by', ...base });
  repo.resolve(e.id, by.id);
  expect(repo.get(e.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: by.id });
  expect(repo.update(e.id, { kind: 'done' })).toMatchObject({ kind: 'done', status: null, resolvedAt: null, resolvedByEntryId: null });
  expect(repo.update(e.id, { kind: 'next' })).toMatchObject({ kind: 'next', status: 'open' });
});
test('resolve(id, byEntryId) stores the resolver', () => {
  const a = repo.add({ summary: 'a', kind: 'next', ...base });
  const b = repo.add({ summary: 'b', ...base });
  const r = repo.resolve(a.id, b.id);
  expect(r).toMatchObject({ status: 'resolved', resolvedByEntryId: b.id });
  expect(r.resolvedAt).not.toBeNull();
});
test('list tags use AND semantics', () => {
  repo.add({ summary: 'xy', ...base, tags: ['x', 'y'] });
  repo.add({ summary: 'x', ...base, tags: ['x'] });
  expect(repo.list({ tags: ['x', 'y'] }).map((e) => e.summary)).toEqual(['xy']);
});
test('list tags apply tag aliases like add', () => {
  config.tagAliases['fix'] = 'bug';
  repo.add({ summary: 'f', ...base, tags: ['fix'] });
  expect(repo.list({ tags: ['fix'] })).toHaveLength(1);
  expect(repo.list({ tags: ['bug'] })).toHaveLength(1);
});
test('list ignores a limit that is not a positive integer', () => {
  repo.add({ summary: 'a', ...base });
  repo.add({ summary: 'b', ...base });
  for (const limit of [0, -1, 1.5, NaN]) expect(repo.list({ limit })).toHaveLength(2);
});
test('update with tags only keeps refs, with refs only keeps tags', () => {
  const e = repo.add({ summary: 's', ...base, tags: ['a'], refs: [{ type: 'url', value: 'https://x.test' }] });
  expect(repo.update(e.id, { tags: ['b'] })).toMatchObject({ tags: ['b'], refs: [{ type: 'url', value: 'https://x.test' }] });
  expect(repo.update(e.id, { refs: [{ type: 'pr', value: '5' }] })).toMatchObject({ tags: ['b'], refs: [{ type: 'pr', value: '5' }] });
});
test('update never drops refs that came from old tags', () => {
  const e = repo.add({ summary: 's', ...base, tags: ['sbdc-1'] });
  expect(e.refs).toEqual([{ type: 'jira', value: 'SBDC-1' }]);
  expect(repo.update(e.id, { tags: ['bug'] })).toMatchObject({ tags: ['bug'], refs: [{ type: 'jira', value: 'SBDC-1' }] });
});
test('softDelete, restore, and resolve throw on an unknown id', () => {
  for (const fn of [repo.softDelete, repo.restore, repo.resolve]) {
    expect(() => fn('missing-id')).toThrow('No entry with id "missing-id"');
  }
});
test('resolve and update surface AmbiguousIdError', () => {
  forceAmbiguous();
  expect(() => repo.resolve('SHARED1')).toThrow(AmbiguousIdError);
  expect(() => repo.update('SHARED1', { summary: 'x' })).toThrow(AmbiguousIdError);
});
test('add and update reject a summary over 120 characters', () => {
  const long = 'x'.repeat(121);
  expect(() => repo.add({ summary: long, ...base })).toThrow('summary is over 120 characters');
  const e = repo.add({ summary: 'x'.repeat(120), ...base });
  expect(() => repo.update(e.id, { summary: long })).toThrow('summary is over 120 characters');
});
test('add dedupes resolves', () => {
  const b = repo.add({ summary: 'blk', kind: 'blocker', ...base });
  expect(() => repo.add({ summary: 'fix', ...base, resolves: [b.id, b.id] })).not.toThrow();
  expect(repo.get(b.id)?.status).toBe('resolved');
});

test('add and update reject an empty summary', () => {
  expect(() => repo.add({ summary: '   ', ...base })).toThrow('summary is empty');
  const e = repo.add({ summary: 'ok', ...base });
  expect(() => repo.update(e.id, { summary: '' })).toThrow('summary is empty');
  expect(repo.get(e.id)!.summary).toBe('ok');
});
