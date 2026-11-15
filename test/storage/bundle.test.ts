import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { exportBundle, importBundle } from '../../src/storage/bundle';
import type { EntryRepository } from '../../src/core/repository';

let home: string; let db: DatabaseSync; let config: Config; let repo: EntryRepository;
function open(name: string) {
  const dbPath = path.join(home, name);
  const d = openDb(dbPath);
  return { d, r: createRepository(d, config, dbPath) };
}
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-bundle-'));
  config = loadConfig(home);
  ({ d: db, r: repo } = open('a.db'));
});
afterEach(() => { db.close(); fs.rmSync(home, { recursive: true, force: true }); });

const base = { project: 'p', source: 'cli' as const };
const ftsHits = (d: DatabaseSync, q: string) =>
  (d.prepare('SELECT e.id FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ? ORDER BY e.id').all(q) as { id: string }[]).map((r) => r.id);

test('round-trips all entries including deleted', () => {
  repo.add({ summary: 'one', tags: ['x'], refs: [{ type: 'pr', value: '12', repo: 'o/r' }], ...base });
  const b = repo.add({ summary: 'two', kind: 'blocker', ...base });
  repo.softDelete(b.id);
  const bundle = exportBundle(db, config);
  expect(bundle).toMatchObject({ format: 'gournal-bundle', schemaVersion: 1, deviceId: config.deviceId });
  expect(bundle.entries).toHaveLength(2);
  const { d: db2, r: repo2 } = open('b.db');
  try {
    expect(importBundle(db2, JSON.parse(JSON.stringify(bundle)))).toEqual({ inserted: 2, updated: 0, skipped: 0 });
    expect(repo2.list({ includeDeleted: true })).toEqual(repo.list({ includeDeleted: true }));
  } finally { db2.close(); }
});

test('later updatedAt wins on import and replaces tags and refs', () => {
  const e = repo.add({ summary: 'old', tags: ['a'], refs: [{ type: 'pr', value: '1' }], ...base });
  const bundle = exportBundle(db, config);
  const next = { ...bundle.entries[0], summary: 'new', tags: ['b', 'Not-Normalized'], refs: [], updatedAt: new Date(Date.parse(e.updatedAt) + 1000).toISOString() };
  expect(importBundle(db, { ...bundle, entries: [next] })).toEqual({ inserted: 0, updated: 1, skipped: 0 });
  expect(repo.get(e.id)).toEqual(next);
  expect(ftsHits(db, 'new')).toEqual([e.id]);
  expect(ftsHits(db, 'old')).toEqual([]);
});

test('older and equal updatedAt are skipped', () => {
  const e = repo.add({ summary: 'keep', ...base });
  const bundle = exportBundle(db, config);
  const older = { ...bundle.entries[0], summary: 'older', updatedAt: new Date(Date.parse(e.updatedAt) - 1000).toISOString() };
  const equal = { ...bundle.entries[0], summary: 'equal' };
  expect(importBundle(db, { ...bundle, entries: [older, equal] })).toEqual({ inserted: 0, updated: 0, skipped: 2 });
  expect(repo.get(e.id)!.summary).toBe('keep');
});

test('rejects a non-bundle', () => {
  expect(() => importBundle(db, { foo: 1 })).toThrow('Not a gournal bundle');
  expect(() => importBundle(db, null)).toThrow('Not a gournal bundle');
  expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 2, entries: [] })).toThrow('Not a gournal bundle');
  expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 1 })).toThrow('Not a gournal bundle');
});

test('a failed import writes nothing', () => {
  repo.add({ summary: 'existing', ...base });
  const before = repo.list({ includeDeleted: true });
  const src = open('c.db');
  try {
    src.r.add({ summary: 'fresh valid', ...base });
    const good = exportBundle(src.d, config).entries[0];
    const bad = { ...good, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', kind: 'oops' };
    expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 1, exportedAt: 'x', deviceId: 'd', entries: [good, bad] }))
      .toThrow('Bundle entry 1 is invalid: kind');
  } finally { src.d.close(); }
  expect(repo.list({ includeDeleted: true })).toEqual(before);
  expect(ftsHits(db, 'fresh')).toEqual([]);
  expect(ftsHits(db, 'existing')).toEqual([before[0].id]);
});

test('a database error mid-import rolls everything back', () => {
  repo.add({ summary: 'existing', ...base });
  const before = repo.list({ includeDeleted: true });
  const src = open('c.db');
  try {
    src.r.add({ summary: 'fresh', ...base });
    const good = exportBundle(src.d, config).entries[0];
    // Same id twice in a row is fine; a duplicate tag violates the primary key on entry_tags.
    const dup = { ...good, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', tags: ['t', 't'] };
    expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 1, entries: [good, dup] })).toThrow();
  } finally { src.d.close(); }
  expect(repo.list({ includeDeleted: true })).toEqual(before);
  expect(ftsHits(db, 'fresh')).toEqual([]);
});

test('an imported entry is searchable through entries_fts', () => {
  const src = open('c.db');
  let entry;
  try {
    entry = src.r.add({ summary: 'zebracorn migration', details: 'quokka details', ...base });
  } finally { src.d.close(); }
  const bundle = { format: 'gournal-bundle', schemaVersion: 1, exportedAt: new Date().toISOString(), deviceId: 'd', entries: [entry] };
  importBundle(db, bundle);
  expect(ftsHits(db, 'zebracorn')).toEqual([entry.id]);
  expect(ftsHits(db, 'quokka')).toEqual([entry.id]);
});

test('preserves device id, timestamps and values exactly', () => {
  const e = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', createdAt: '2020-01-02T03:04:05.006Z', updatedAt: '2021-01-02T03:04:05.007Z',
    deletedAt: '2022-01-02T03:04:05.008Z', deviceId: 'other-device', summary: 'Café ☕', details: null, kind: 'next',
    status: 'resolved', resolvedAt: '2021-06-01T00:00:00.000Z', resolvedByEntryId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    project: 'Proj', repo: null, branch: 'b', source: 'migration', agent: 'a', tags: ['Weird Tag'],
    refs: [{ type: 'jira', value: 'abc-1' }, { type: 'pr', value: '3', repo: 'o/r' }],
  };
  importBundle(db, { format: 'gournal-bundle', schemaVersion: 1, entries: [e] });
  expect(repo.list({ includeDeleted: true })).toEqual([e]);
});

test.each([
  ['id', { id: 'short' }], ['id', { id: '01ARZ3NDEKTSV4RRFFQ69G5FAU' }], ['createdAt', { createdAt: 'nope' }],
  ['updatedAt', { updatedAt: 5 }], ['deletedAt', { deletedAt: 'x' }], ['resolvedAt', { resolvedAt: 'x' }],
  ['kind', { kind: 'oops' }], ['status', { status: 'weird' }], ['source', { source: 'web' }],
  ['summary', { summary: '' }], ['summary', { summary: 'x'.repeat(121) }], ['tags', { tags: 'a' }], ['tags', { tags: [1] }],
  ['refs', { refs: [{ type: 'bad', value: 'v' }] }], ['refs', { refs: [{ type: 'pr', value: 1 }] }],
  ['refs', { refs: [{ type: 'pr', value: 'v', repo: 3 }] }], ['deviceId', { deviceId: 1 }], ['project', { project: null }],
  ['details', { details: 3 }], ['entry', null],
])('rejects invalid %s', (field, patch) => {
  const good = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    deletedAt: null, deviceId: 'd', summary: 's', details: null, kind: 'done', status: null, resolvedAt: null,
    resolvedByEntryId: null, project: 'p', repo: null, branch: null, source: 'cli', agent: null, tags: [], refs: [] };
  const entry = patch === null ? null : { ...good, ...patch };
  expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 1, entries: [entry] }))
    .toThrow(`Bundle entry 0 is invalid: ${field}`);
  expect(repo.list({ includeDeleted: true })).toEqual([]);
});
