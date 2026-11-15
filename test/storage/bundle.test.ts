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
    expect(importBundle(db2, JSON.parse(JSON.stringify(bundle)))).toEqual({ inserted: 2, updated: 0, skipped: 0, deduplicated: 0 });
    expect(repo2.list({ includeDeleted: true })).toEqual(repo.list({ includeDeleted: true }));
  } finally { db2.close(); }
});

test('later updatedAt wins on import and replaces tags and refs', () => {
  const e = repo.add({ summary: 'old', tags: ['a'], refs: [{ type: 'pr', value: '1' }], ...base });
  const bundle = exportBundle(db, config);
  const next = { ...bundle.entries[0], summary: 'new', tags: ['b', 'Not-Normalized'], refs: [], updatedAt: new Date(Date.parse(e.updatedAt) + 1000).toISOString() };
  expect(importBundle(db, { ...bundle, entries: [next] })).toEqual({ inserted: 0, updated: 1, skipped: 0, deduplicated: 0 });
  expect(repo.get(e.id)).toEqual(next);
  expect(ftsHits(db, 'new')).toEqual([e.id]);
  expect(ftsHits(db, 'old')).toEqual([]);
});

test('older and equal updatedAt are skipped', () => {
  const e = repo.add({ summary: 'keep', ...base });
  const bundle = exportBundle(db, config);
  const older = { ...bundle.entries[0], summary: 'older', updatedAt: new Date(Date.parse(e.updatedAt) - 1000).toISOString() };
  const equal = { ...bundle.entries[0], summary: 'equal' };
  expect(importBundle(db, { ...bundle, entries: [older, equal] })).toEqual({ inserted: 0, updated: 0, skipped: 2, deduplicated: 0 });
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

test('a database error mid-import rolls back earlier inserts', () => {
  repo.add({ summary: 'existing', ...base });
  const before = repo.list({ includeDeleted: true });
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON entries WHEN new.summary = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END");
  const src = open('c.db');
  try {
    src.r.add({ summary: 'fresh', ...base });
    const good = exportBundle(src.d, config).entries[0];
    const boom = { ...good, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', summary: 'boom' };
    expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 1, entries: [good, boom] })).toThrow('boom');
  } finally { src.d.close(); }
  expect(repo.list({ includeDeleted: true })).toEqual(before);
  expect(ftsHits(db, 'fresh')).toEqual([]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM entry_tags').get()).toEqual({ n: 0 });
});

const goodEntry = () => ({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
  deletedAt: null, deviceId: 'd', summary: 's', details: null, kind: 'done', status: null, resolvedAt: null,
  resolvedByEntryId: null, project: 'p', repo: null, branch: null, source: 'cli', agent: null, tags: [], refs: [] });
const wrap = (entries: unknown[]) => ({ format: 'gournal-bundle', schemaVersion: 1, entries });

test('summary limit counts code points: 120 emoji pass, 121 fail', () => {
  expect(importBundle(db, wrap([{ ...goodEntry(), summary: '\u{1F600}'.repeat(120) }])).inserted).toBe(1);
  expect(() => importBundle(db, wrap([{ ...goodEntry(), id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', summary: '\u{1F600}'.repeat(121) }])))
    .toThrow('Bundle entry 0 is invalid: summary');
});

test('the same id twice in one bundle skips the second copy', () => {
  const e = goodEntry();
  expect(importBundle(db, wrap([e, { ...e, summary: 'second' }]))).toEqual({ inserted: 1, updated: 0, skipped: 1, deduplicated: 0 });
  expect(repo.get(e.id)!.summary).toBe('s');
});

test('a newer entry for a locally soft-deleted id clears deleted_at', () => {
  const e = repo.add({ summary: 'gone', ...base });
  repo.softDelete(e.id);
  const live = { ...exportBundle(db, config).entries[0], deletedAt: null, updatedAt: new Date(Date.now() + 60000).toISOString() };
  expect(importBundle(db, wrap([live])).updated).toBe(1);
  expect(repo.get(e.id)!.deletedAt).toBeNull();
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
  ['updatedAt', { updatedAt: 5 }], ['createdAt', { createdAt: '1' }], ['createdAt', { createdAt: 'Jan 5 2020' }],
  ['createdAt', { createdAt: '2020-01-01T00:00:00' }], ['deletedAt', { deletedAt: '2020-01-01T00:00:00' }],
  ['resolvedAt', { resolvedAt: 'Jan 5 2020' }], ['tags', { tags: ['a', 'a'] }], ['deletedAt', { deletedAt: 'x' }], ['resolvedAt', { resolvedAt: 'x' }],
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

describe('legacy map in bundles', () => {
  const addLegacy = (d: DatabaseSync, r: EntryRepository, n: number, hash = 'h') => {
    const e = r.add({ summary: `legacy ${n}`, ...base, source: 'migration' });
    d.prepare('INSERT INTO legacy_map (legacy_index, timestamp, message_hash, occurrence, entry_id) VALUES (?, ?, ?, 0, ?)')
      .run(n, `2026-07-0${n + 1}T00:00:00.000Z`, `${hash}${n}`, e.id);
    return e;
  };
  const mapRows = (d: DatabaseSync) => d.prepare('SELECT legacy_index, entry_id FROM legacy_map ORDER BY legacy_index').all() as { legacy_index: number; entry_id: string }[];

  test('export carries every legacy_map row', () => {
    const e = addLegacy(db, repo, 0);
    const bundle = exportBundle(db, config);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.legacyMap).toEqual([{ legacyIndex: 0, timestamp: '2026-07-01T00:00:00.000Z', messageHash: 'h0', occurrence: 0, entryId: e.id }]);
  });

  test('a new key is inserted into legacy_map on import', () => {
    const e = addLegacy(db, repo, 0);
    const bundle = JSON.parse(JSON.stringify(exportBundle(db, config)));
    const { d: db2 } = open('b.db');
    try {
      expect(importBundle(db2, bundle)).toEqual({ inserted: 1, updated: 0, skipped: 0, deduplicated: 0 });
      expect(mapRows(db2)).toEqual([{ legacy_index: 0, entry_id: e.id }]);
    } finally { db2.close(); }
  });

  test('the same legacy line under two ids keeps the later one live and soft-deletes the other', () => {
    const { d: db2, r: repo2 } = open('b.db');
    try {
      const mine = addLegacy(db, repo, 0);
      const theirs = addLegacy(db2, repo2, 0);
      db2.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(Date.parse(mine.updatedAt) + 5000, theirs.id);
      const bundle = JSON.parse(JSON.stringify(exportBundle(db2, config)));
      expect(importBundle(db, bundle)).toEqual({ inserted: 1, updated: 0, skipped: 0, deduplicated: 1 });
      expect(repo.get(theirs.id)!.deletedAt).toBeNull();
      expect(repo.get(mine.id)!.deletedAt).not.toBeNull();
      expect(mapRows(db)).toEqual([{ legacy_index: 0, entry_id: theirs.id }]);
      // The loser is kept, never erased.
      expect(repo.list({ includeDeleted: true })).toHaveLength(2);
    } finally { db2.close(); }
  });

  test('when the local entry is later, it survives', () => {
    const { d: db2, r: repo2 } = open('b.db');
    try {
      const theirs = addLegacy(db2, repo2, 0);
      const mine = addLegacy(db, repo, 0);
      db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(Date.parse(theirs.updatedAt) + 5000, mine.id);
      const bundle = JSON.parse(JSON.stringify(exportBundle(db2, config)));
      expect(importBundle(db, bundle).deduplicated).toBe(1);
      expect(repo.get(mine.id)!.deletedAt).toBeNull();
      expect(repo.get(theirs.id)!.deletedAt).not.toBeNull();
      expect(mapRows(db)).toEqual([{ legacy_index: 0, entry_id: mine.id }]);
    } finally { db2.close(); }
  });

  test('an old bundle without legacyMap still imports', () => {
    repo.add({ summary: 'plain', ...base });
    const { legacyMap: _drop, ...old } = exportBundle(db, config);
    const { d: db2 } = open('b.db');
    try {
      expect(importBundle(db2, JSON.parse(JSON.stringify(old)))).toEqual({ inserted: 1, updated: 0, skipped: 0, deduplicated: 0 });
    } finally { db2.close(); }
  });

  test('a bad legacyMap row is rejected and nothing is written', () => {
    repo.add({ summary: 'plain', ...base });
    const bundle = JSON.parse(JSON.stringify(exportBundle(db, config)));
    bundle.legacyMap = [{ legacyIndex: 'x' }];
    const { d: db2 } = open('b.db');
    try {
      expect(() => importBundle(db2, bundle)).toThrow('Bundle legacyMap row 0 is invalid');
      expect(db2.prepare('SELECT count(*) AS n FROM entries').get()).toEqual({ n: 0 });
    } finally { db2.close(); }
  });
});
