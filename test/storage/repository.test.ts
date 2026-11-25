import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { ftsTest } from '../fts5';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository, AmbiguousIdError } from '../../src/storage/sqlite-repository';
import type { EntryRepository } from '../../src/core';
import { InvalidQueryError } from '../../src/core';
import { makeTmp, rmTmp } from '../helpers/tmp';

let home: string; let db: DatabaseSync; let config: Config; let repo: EntryRepository;
beforeEach(() => {
  home = makeTmp('gournal-repo-');
  const dbPath = path.join(home, 'gournal.db');
  db = openDb(dbPath);
  config = loadConfig(home);
  config.ticketPrefixes = ['sbdc'];
  repo = createRepository(db, config, dbPath);
});
afterEach(() => { db.close(); rmTmp(home); });

const base = { project: 'p', source: 'cli' as const };

test('add stores a v2 entry with defaults', () => {
  const e = repo.add({ summary: 'Fixed it', project: 'api', source: 'cli', tags: ['Bug', 'sbdc-1'] });
  expect(e).toMatchObject({ summary: 'Fixed it', kind: 'done', status: null, project: 'api', tags: ['bug'],
    refs: [{ type: 'jira', value: 'SBDC-1' }], deviceId: config.deviceId, deletedAt: null });
  expect(repo.get(e.id)).toEqual(e);
});
test('project aliases match case-insensitively on add and update', () => {
  config.projectAliases['gournal'] = 'Gournal App';
  expect(repo.add({ summary: 's', project: 'Gournal', source: 'cli' }).project).toBe('Gournal App');
  const e = repo.add({ summary: 't', project: 'other', source: 'cli' });
  expect(repo.update(e.id, { project: 'GOURNAL' }).project).toBe('Gournal App');
  expect(repo.get(e.id)?.project).toBe('Gournal App');
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
test('add with a bad resolves id writes nothing', () => {
  const done = repo.add({ summary: 'done one', ...base });
  const b = repo.add({ summary: 'blocked', kind: 'blocker', ...base });
  expect(() => repo.add({ summary: 'x', ...base, resolves: [b.id, done.id] })).toThrow('only an open blocker or next');
  expect(repo.find()).toHaveLength(2);
  expect(repo.get(b.id)?.status).toBe('open');
});
test('softDelete hides and restore returns', () => {
  const e = repo.add({ summary: 's', ...base });
  expect(repo.softDelete(e.id).deletedAt).not.toBeNull();
  expect(repo.find()).toEqual([]);
  expect(repo.find({ includeDeleted: true })[0].deletedAt).not.toBeNull();
  expect(repo.restore(e.id).deletedAt).toBeNull();
});
test('softDeleteAll hides every entry and returns the count', () => {
  repo.add({ summary: 'a', ...base });
  repo.add({ summary: 'b', ...base });
  expect(repo.softDeleteAll()).toBe(2);
  expect(repo.find()).toEqual([]);
  expect(repo.softDeleteAll()).toBe(0);
});
test('update changes fields and updated_at', () => {
  const e = repo.add({ summary: 's', ...base });
  db.prepare('UPDATE entries SET updated_at = 1 WHERE id = ?').run(e.id);
  const u = repo.update(e.id, { summary: 't', tags: ['X'] });
  expect(u).toMatchObject({ summary: 't', tags: ['x'] });
  expect(u.updatedAt > new Date(1).toISOString()).toBe(true);
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
test('list filters by project, tags, and bounds, oldest first', () => {
  const a = repo.add({ summary: 'a', project: 'a', source: 'cli', tags: ['x'], createdAt: '2026-07-03T10:00:00.000Z' });
  const b = repo.add({ summary: 'b', project: 'a', source: 'cli', tags: [], createdAt: '2026-07-01T10:00:00.000Z' });
  const c = repo.add({ summary: 'c', project: 'b', source: 'cli', tags: ['x'], createdAt: '2026-07-02T10:00:00.000Z' });
  expect(repo.find().map((e) => e.id)).toEqual([b.id, c.id, a.id]);
  expect(repo.find({ project: 'a' }).map((e) => e.id)).toEqual([b.id, a.id]);
  expect(repo.find({ tags: ['x'] }).map((e) => e.id)).toEqual([c.id, a.id]);
  expect(repo.find({ from: '2026-07-02T00:00:00.000Z' })).toHaveLength(2);
  expect(repo.find({ to: '2026-07-01T23:59:59.999Z' }).map((e) => e.id)).toEqual([b.id]);
  expect(repo.find({ limit: 1 }).map((e) => e.id)).toEqual([b.id]);
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
ftsTest('FTS index follows updates', () => {
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
  repo.update(e.id, { kind: 'blocker' });
  repo.resolve(e.id, by.id);
  expect(repo.update(e.id, { kind: 'next' })).toMatchObject({ kind: 'next', status: 'open', resolvedAt: null, resolvedByEntryId: null });
});
test('resolve(id, byEntryId) stores the resolver', () => {
  const a = repo.add({ summary: 'a', kind: 'next', ...base });
  const b = repo.add({ summary: 'b', ...base });
  const r = repo.resolve(a.id, b.id);
  expect(r).toMatchObject({ status: 'resolved', resolvedByEntryId: b.id });
  expect(r.resolvedAt).not.toBeNull();
  const c = repo.add({ summary: 'c', kind: 'next', ...base });
  const d = repo.add({ summary: 'd', ...base });
  expect(repo.resolve(c.id.slice(-8), d.id.slice(-8))).toMatchObject({ status: 'resolved', resolvedByEntryId: d.id });
  const e = repo.add({ summary: 'e', kind: 'blocker', ...base });
  expect(repo.resolve(e.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: null });
});
test('list tags use AND semantics', () => {
  repo.add({ summary: 'xy', ...base, tags: ['x', 'y'] });
  repo.add({ summary: 'x', ...base, tags: ['x'] });
  expect(repo.find({ tags: ['x', 'y'] }).map((e) => e.summary)).toEqual(['xy']);
});
test('list tags apply tag aliases like add', () => {
  config.tagAliases['fix'] = 'bug';
  repo.add({ summary: 'f', ...base, tags: ['fix'] });
  expect(repo.find({ tags: ['fix'] })).toHaveLength(1);
  expect(repo.find({ tags: ['bug'] })).toHaveLength(1);
});
test('find rejects a limit that is not a positive integer', () => {
  repo.add({ summary: 'a', ...base });
  repo.add({ summary: 'b', ...base });
  for (const limit of [0, -1, 1.5, NaN]) expect(() => repo.find({ limit })).toThrow(InvalidQueryError);
});
test('update with tags only keeps refs, with refs only keeps tags, and never drops refs from old tags', () => {
  const e = repo.add({ summary: 's', ...base, tags: ['a'], refs: [{ type: 'url', value: 'https://x.test' }] });
  expect(repo.update(e.id, { tags: ['b'] })).toMatchObject({ tags: ['b'], refs: [{ type: 'url', value: 'https://x.test' }] });
  expect(repo.update(e.id, { refs: [{ type: 'pr', value: '5' }] })).toMatchObject({ tags: ['b'], refs: [{ type: 'pr', value: '5' }] });
  const j = repo.add({ summary: 's', ...base, tags: ['sbdc-1'] });
  expect(j.refs).toEqual([{ type: 'jira', value: 'SBDC-1' }]);
  expect(repo.update(j.id, { tags: ['bug'] })).toMatchObject({ tags: ['bug'], refs: [{ type: 'jira', value: 'SBDC-1' }] });
});
test('softDelete, restore, resolve, and update throw on an unknown id', () => {
  for (const fn of [repo.softDelete, repo.restore, repo.resolve]) {
    expect(() => fn('missing-id')).toThrow('No entry with id "missing-id"');
  }
  expect(() => repo.update('missing-id', { summary: 'x' })).toThrow('No entry with id "missing-id"');
});
test('get, resolve, and update surface AmbiguousIdError when a suffix matches two entries', () => {
  forceAmbiguous();
  expect(() => repo.get('SHARED1')).toThrow(AmbiguousIdError);
  expect(() => repo.get('SHARED1')).toThrow('Id "SHARED1" matches more than one entry; use more characters.');
  expect(() => repo.resolve('SHARED1')).toThrow(AmbiguousIdError);
  expect(() => repo.update('SHARED1', { summary: 'x' })).toThrow(AmbiguousIdError);
});
test.each([
  ['over 120 characters', 'x'.repeat(121), 'summary is over 120 characters'],
  ['empty', '', 'summary is empty'],
  ['blank', '   ', 'summary is empty'],
  ['a newline', 'one\ntwo', 'summary must be one line'],
  ['a CR', 'one\rtwo', 'summary must be one line'],
  ['U+2028', 'one\u2028two', 'summary must be one line'],
  ['U+2029', 'one\u2029two', 'summary must be one line'],
])('add and update reject a summary that is %s', (_label, summary, message) => {
  expect(() => repo.add({ summary, ...base })).toThrow(message);
  const ok = 'x'.repeat(120);
  const e = repo.add({ summary: ok, ...base });
  expect(() => repo.update(e.id, { summary })).toThrow(message);
  expect(repo.get(e.id)!.summary).toBe(ok);
});

test('transaction commits nested writes together', () => {
  const ids = repo.transaction(() => [repo.add({ summary: 'a', ...base }).id, repo.add({ summary: 'b', ...base }).id]);
  expect(repo.find().map((e) => e.id).sort()).toEqual([...ids].sort());
});
test('transaction rolls back every nested write on error and stays usable', () => {
  expect(() => repo.transaction(() => { repo.add({ summary: 'a', ...base }); throw new Error('boom'); })).toThrow('boom');
  expect(repo.find()).toHaveLength(0);
  repo.add({ summary: 'after', ...base });
  expect(repo.find()).toHaveLength(1);
});

test('add dedupes resolves by the resolved id, not the raw string', () => {
  const b = repo.add({ summary: 'blk', kind: 'blocker', ...base });
  expect(() => repo.add({ summary: 'fix', ...base, resolves: [b.id, b.id.slice(-8)] })).not.toThrow();
  expect(repo.get(b.id)?.status).toBe('resolved');
});

describe('control characters are stripped on write', () => {
  const dirty = (t: string) => `a\x1b]0;${t}\x07b\x1b[2Jc\x9bd\x7fe`;
  const clean = (t: string) => `a]0;${t}b[2Jcde`;

  test('add strips every single-line field and keeps tab and newline in details', () => {
    const e = repo.add({
      summary: dirty('s'), details: 'line1\n\tline2\x1b[31m\r\x00end', project: dirty('p'), repo: dirty('r'), branch: dirty('b'),
      agent: dirty('g'), source: 'cli', tags: [dirty('Tag')], refs: [{ type: 'url', value: dirty('u'), repo: dirty('rr') }],
    });
    expect(e.summary).toBe(clean('s'));
    expect(e.details).toBe('line1\n\tline2[31mend');
    expect(e).toMatchObject({ project: clean('p'), repo: clean('r'), branch: clean('b'), agent: clean('g') });
    expect(e.tags).toEqual([clean('tag').toLowerCase()]);
    expect(e.refs).toEqual([{ type: 'url', value: clean('u'), repo: clean('rr') }]);
    expect(repo.get(e.id)).toEqual(e);
  });

  test('update strips the same fields', () => {
    const e = repo.add({ ...base, summary: 'x' });
    const u = repo.update(e.id, {
      summary: dirty('s'), details: 'a\nb\x1b', project: dirty('p'), repo: dirty('r'), branch: dirty('b'),
      tags: [dirty('Tag')], refs: [{ type: 'url', value: dirty('u') }],
    });
    expect(u).toMatchObject({ summary: clean('s'), details: 'a\nb', project: clean('p'), repo: clean('r'), branch: clean('b'), tags: [clean('tag').toLowerCase()] });
    expect(u.refs).toEqual([{ type: 'url', value: clean('u') }]);
  });

  test('a project of only control characters falls back to the default project on add and update', () => {
    const e = repo.add({ summary: 's', project: '\x1b\x07', source: 'cli' });
    expect(e.project).toBe('uncategorized');
    const other = repo.add({ summary: 't', project: 'real', source: 'cli' });
    expect(repo.update(other.id, { project: '\x1b\x9b' }).project).toBe('uncategorized');
  });

  test('a summary of only control characters is empty', () => {
    expect(() => repo.add({ ...base, summary: '\x1b\x07' })).toThrow('summary is empty');
  });
});
