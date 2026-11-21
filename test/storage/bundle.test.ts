import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { hasFts5, ftsTest } from '../fts5';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { exportBundle, importBundle } from '../../src/storage/bundle';
import { createActivityRepository } from '../../src/storage/activity-repository';
import type { EntryRepository } from '../../src/core';
import { makeTmp, rmTmp } from '../helpers/tmp';

let home: string; let db: DatabaseSync; let config: Config; let repo: EntryRepository;
function open(name: string) {
  const dbPath = path.join(home, name);
  const d = openDb(dbPath);
  return { d, r: createRepository(d, config, dbPath) };
}
beforeEach(() => {
  home = makeTmp('gournal-bundle-');
  config = loadConfig(home);
  ({ d: db, r: repo } = open('a.db'));
});
afterEach(() => { db.close(); rmTmp(home); });

const base = { project: 'p', source: 'cli' as const };
const ftsHits = (d: DatabaseSync, q: string) =>
  (d.prepare('SELECT e.id FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ? ORDER BY e.id').all(q) as { id: string }[]).map((r) => r.id);
// With no FTS5 there is no index to read. The FTS assertions are skipped and the rest of the test still runs.
const expectFts = (d: DatabaseSync, q: string, ids: string[]) => { if (hasFts5) expect(ftsHits(d, q)).toEqual(ids); };

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
    expect(repo2.find({ includeDeleted: true })).toEqual(repo.find({ includeDeleted: true }));
  } finally { db2.close(); }
});

test('later updatedAt wins on import and replaces tags and refs', () => {
  const e = repo.add({ summary: 'old', tags: ['a'], refs: [{ type: 'pr', value: '1' }], ...base });
  const bundle = exportBundle(db, config);
  const next = { ...bundle.entries[0], summary: 'new', tags: ['b', 'Not-Normalized'], refs: [], updatedAt: new Date(Date.parse(e.updatedAt) + 1000).toISOString() };
  expect(importBundle(db, { ...bundle, entries: [next] })).toEqual({ inserted: 0, updated: 1, skipped: 0 });
  expect(repo.get(e.id)).toEqual(next);
  expectFts(db, 'new', [e.id]);
  expectFts(db, 'old', []);
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
  const before = repo.find({ includeDeleted: true });
  const src = open('c.db');
  try {
    src.r.add({ summary: 'fresh valid', ...base });
    const good = exportBundle(src.d, config).entries[0];
    const bad = { ...good, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', kind: 'oops' };
    expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 1, exportedAt: 'x', deviceId: 'd', entries: [good, bad] }))
      .toThrow('Bundle entry 1 is invalid: kind');
  } finally { src.d.close(); }
  expect(repo.find({ includeDeleted: true })).toEqual(before);
  expectFts(db, 'fresh', []);
  expectFts(db, 'existing', [before[0].id]);
});

test('a database error mid-import rolls back earlier inserts', () => {
  repo.add({ summary: 'existing', ...base });
  const before = repo.find({ includeDeleted: true });
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON entries WHEN new.summary = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END");
  const src = open('c.db');
  try {
    src.r.add({ summary: 'fresh', ...base });
    const good = exportBundle(src.d, config).entries[0];
    const boom = { ...good, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', summary: 'boom' };
    expect(() => importBundle(db, { format: 'gournal-bundle', schemaVersion: 1, entries: [good, boom] })).toThrow('boom');
  } finally { src.d.close(); }
  expect(repo.find({ includeDeleted: true })).toEqual(before);
  expectFts(db, 'fresh', []);
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
  expect(importBundle(db, wrap([e, { ...e, summary: 'second' }]))).toEqual({ inserted: 1, updated: 0, skipped: 1 });
  expect(repo.get(e.id)!.summary).toBe('s');
});

test('a newer entry for a locally soft-deleted id clears deleted_at', () => {
  const e = repo.add({ summary: 'gone', ...base });
  repo.softDelete(e.id);
  const live = { ...exportBundle(db, config).entries[0], deletedAt: null, updatedAt: new Date(Date.now() + 60000).toISOString() };
  expect(importBundle(db, wrap([live])).updated).toBe(1);
  expect(repo.get(e.id)!.deletedAt).toBeNull();
});

ftsTest('an imported entry is searchable through entries_fts', () => {
  const src = open('c.db');
  let entry;
  try {
    entry = src.r.add({ summary: 'zebracorn migration', details: 'quokka details', ...base });
  } finally { src.d.close(); }
  const bundle = { format: 'gournal-bundle', schemaVersion: 1, exportedAt: new Date().toISOString(), deviceId: 'd', entries: [entry] };
  importBundle(db, bundle);
  expectFts(db, 'zebracorn', [entry.id]);
  expectFts(db, 'quokka', [entry.id]);
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
  expect(repo.find({ includeDeleted: true })).toEqual([e]);
});

test.each([
  ['id', { id: 'short' }], ['id', { id: '01ARZ3NDEKTSV4RRFFQ69G5FAU' }], ['createdAt', { createdAt: 'nope' }],
  ['updatedAt', { updatedAt: 5 }], ['createdAt', { createdAt: '2020-01-01T00:00:00' }], ['deletedAt', { deletedAt: '2020-01-01T00:00:00' }],
  ['resolvedAt', { resolvedAt: 'Jan 5 2020' }], ['tags', { tags: ['a', 'a'] }],
  ['kind', { kind: 'oops' }], ['status', { status: 'weird' }], ['source', { source: 'web' }],
  ['summary', { summary: '' }], ['tags', { tags: 'a' }], ['tags', { tags: [1] }],
  ['refs', { refs: [{ type: 'bad', value: 'v' }] }], ['refs', { refs: [{ type: 'pr', value: 1 }] }],
  ['refs', { refs: [{ type: 'pr', value: 'v', repo: 3 }] }], ['deviceId', { deviceId: 1 }], ['project', { project: null }],
  ['details', { details: 3 }], ['entry', null],
  ['entry', []], ['entry', 'x'], ['entry', 5],
  ['refs', { refs: [{ type: 'pr', value: 'v', repo: null }] }], ['refs', { refs: [[]] }], ['refs', { refs: [null] }],
  ['resolvedByEntryId', { resolvedByEntryId: 1 }],
  ['createdAt', { createdAt: '2020-01-01T00:00:00Z' }], ['createdAt', { createdAt: '2020-01-01T00:00:00.000+00:00' }],
  ['id', { id: '01arz3ndektsv4rrffq69g5fav' }], ['id', { id: 'short', kind: 'oops' }],
])('rejects invalid entry %s', (field, patch) => {
  const entry = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? { ...goodEntry(), ...patch } : patch;
  expect(() => importBundle(db, wrap([entry]))).toThrow(`Bundle entry 0 is invalid: ${field}`);
  expect(repo.find({ includeDeleted: true })).toEqual([]);
});

// Pins of what the hand validator accepts and rejects today. The zod switch must keep every row.
const goodAct = () => ({ id: '01ARZ3NDEKTSV4RRFFQ69G5FB0', createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z',
  deletedAt: null, deviceId: 'd', type: 'pr_opened', occurredAt: '2026-11-10T10:00:00.000Z', repo: 'acme/widgets', branch: null,
  externalId: '5', title: null, url: null, capturedBy: 'github', pr: 5, payload: {} });
const withExtra = (extra: Record<string, unknown>) => ({ ...wrap([goodEntry()]), ...extra });
const without = <T extends object>(o: T, key: string): Partial<T> => { const { [key]: _drop, ...rest } = o as Record<string, unknown>; return rest as Partial<T>; };

test.each([
  ['an extra bundle key', { ...wrap([goodEntry()]), extra: 1 }],
  ['an extra entry key', wrap([{ ...goodEntry(), extra: 'x' }])],
  ['an extra ref key', wrap([{ ...goodEntry(), refs: [{ type: 'pr', value: '1', extra: true }] }])],
  ['an extra activity key', withExtra({ activity: [{ ...goodAct(), extra: 1 }] })],
  ['an activity row without capturedBy', withExtra({ activity: [without(goodAct(), 'capturedBy')] })],
  ["capturedBy 'gitlab'", withExtra({ activity: [{ ...goodAct(), capturedBy: 'gitlab' }] })],
  ['an activity pr of 2 ** 53 + 2', withExtra({ activity: [{ ...goodAct(), pr: 2 ** 53 + 2 }] })],
  ['a six-digit year in createdAt', wrap([{ ...goodEntry(), createdAt: '+020000-01-01T00:00:00.000Z' }])],
  ["status 'open' on a done entry", wrap([{ ...goodEntry(), status: 'open' }])],
])('accepts %s', (_name, bundle) => {
  expect(importBundle(db, bundle).inserted).toBe(1);
  expect(repo.find({ includeDeleted: true })).toHaveLength(1);
});

test('the big-integer activity pr row is stored', () => {
  importBundle(db, withExtra({ activity: [{ ...goodAct(), pr: 2 ** 53 + 2 }] }));
  expect(db.prepare('SELECT COUNT(*) AS n FROM activity').get()).toEqual({ n: 1 });
});

test('a bundle that still carries a legacyMap key imports, and the key is ignored', () => {
  const legacyMap = [{ legacyIndex: 'x' }];
  expect(importBundle(db, withExtra({ legacyMap })).inserted).toBe(1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM legacy_map').get()).toEqual({ n: 0 });
  expect(exportBundle(db, config)).not.toHaveProperty('legacyMap');
});

test('an accepted extra key is never written to the database', () => {
  importBundle(db, withExtra({ entries: [{ ...goodEntry(), extra: 'x', refs: [{ type: 'pr', value: '1', extra: true }] }] }));
  const got = repo.find({ includeDeleted: true })[0];
  expect(got).not.toHaveProperty('extra');
  expect(got.refs).toEqual([{ type: 'pr', value: '1' }]);
});

test('an activity row without capturedBy is stored as github', () => {
  importBundle(db, withExtra({ activity: [without(goodAct(), 'capturedBy'), { ...goodAct(), id: '01ARZ3NDEKTSV4RRFFQ69G5FB1', externalId: '6', capturedBy: 'gitlab' }] }));
  const a = createActivityRepository(db, config, null).find();
  expect(a.map((x) => x.capturedBy)).toEqual(['github', 'github']);
});

test('rejects an entry with no details key', () => {
  expect(() => importBundle(db, wrap([without(goodEntry(), 'details')]))).toThrow('Bundle entry 0 is invalid: details');
});

test.each([
  ['pr', { pr: 1.5 }], ['pr', { pr: '1' }], ['payload', { payload: [] }], ['payload', { payload: null }],
  ['repo', { repo: null }], ['title', { title: 1 }], ['activity', []],
])('rejects invalid activity %s (pinned)', (field, patch) => {
  const row = Array.isArray(patch) ? patch : { ...goodAct(), ...patch };
  expect(() => importBundle(db, withExtra({ activity: [row] }))).toThrow(`Bundle activity 0 is invalid: ${field}`);
  expect(repo.find({ includeDeleted: true })).toEqual([]);
});

describe('activity in bundles', () => {
  const act = (over: Record<string, unknown> = {}) => ({
    type: 'pr_opened' as const, occurredAt: '2026-11-10T10:00:00.000Z', repo: 'acme/widgets', branch: 'feat/x',
    externalId: '5', title: 'Add x', url: null, pr: 5, payload: { state: 'open' }, ...over,
  });
  const entryRefs = [{ type: 'pr' as const, value: '5', repo: 'acme/widgets' }];

  test('export includes activity; import upserts by type, repo, and external id and relinks', async () => {
    const { d: db2, r: repo2 } = open('b.db');
    const act2 = createActivityRepository(db2, config, path.join(home, 'b.db'));
    // The local row is older than the bundle row, so the bundle wins on import.
    const local = act2.upsert([act({ title: 'old title' })]).ids[0];
    await new Promise((r) => setTimeout(r, 5));
    const act1 = createActivityRepository(db, config, path.join(home, 'a.db'));
    const { ids } = act1.upsert([act(), act({ type: 'review', externalId: 'r9', pr: 7 })]);
    const bundle = JSON.parse(JSON.stringify(exportBundle(db, config)));
    expect(bundle.activity).toHaveLength(2);
    expect(bundle.schemaVersion).toBe(1);

    try {
      const entry = repo2.add({ summary: 'ship x', refs: entryRefs, ...base });
      const withEntry = { ...bundle, entries: [...bundle.entries, { ...JSON.parse(JSON.stringify(entry)) }] };
      const r = importBundle(db2, withEntry, config);
      expect(r.inserted).toBe(0);
      const found = act2.find();
      expect(found).toHaveLength(2);
      const pr5 = found.find((a) => a.externalId === '5')!;
      expect(pr5.id).toBe(local);
      expect(pr5.id).not.toBe(ids[0]);
      expect(pr5.title).toBe('Add x');
      // The entry already existed locally. The import relinked it to the activity.
      expect(act2.linkedTo([entry.id])[entry.id].map((a) => a.externalId)).toEqual(['5']);
      expect(importBundle(db2, withEntry, config).skipped).toBeGreaterThan(0);
      expect(act2.find()).toHaveLength(2);
    } finally { db2.close(); }
  });

  test('a new imported entry links to activity that already exists locally', () => {
    const { d: db2 } = open('b.db');
    const act2 = createActivityRepository(db2, config, path.join(home, 'b.db'));
    try {
      act2.upsert([act()]);
      const entry = repo.add({ summary: 'ship x', refs: entryRefs, ...base });
      const bundle = JSON.parse(JSON.stringify(exportBundle(db, config)));
      delete bundle.activity; // the activity is not part of the import. It is already local.
      expect(importBundle(db2, bundle, config)).toMatchObject({ inserted: 1 });
      expect(act2.linkedTo([entry.id])[entry.id]?.map((a) => a.externalId)).toEqual(['5']);
    } finally { db2.close(); }
  });

  test('an older bundle activity row does not overwrite a newer local one', () => {
    const a = createActivityRepository(db, config, path.join(home, 'a.db'));
    a.upsert([act()]);
    const bundle = JSON.parse(JSON.stringify(exportBundle(db, config)));
    a.upsert([act({ title: 'newer local' })]);
    importBundle(db, bundle, config);
    expect(a.find()[0].title).toBe('newer local');
  });
});

describe('bundle import strips control characters', () => {
  const dirty = (t: string) => `a\x1b]0;${t}\x07b\x1b[2Jc\x9bd\x7fe`;
  const clean = (t: string) => `a]0;${t}b[2Jcde`;
  const dirtyEntry = (updatedAt: string) => {
    const e = repo.add({ summary: 'seed', ...base });
    const b = exportBundle(db, config);
    return {
      id: e.id,
      bundle: b,
      next: {
        ...b.entries[0],
        summary: dirty('s'), details: 'l1\n\tl2\x1b[31m\x00end', project: dirty('p'), repo: dirty('r'), branch: dirty('b'),
        agent: dirty('g'), tags: ['t\x1b', 'x\x07', 't', '\x1b'], refs: [{ type: 'url' as const, value: dirty('u'), repo: dirty('rr') }, { type: 'pr' as const, value: '\x1b' }],
        updatedAt,
      },
    };
  };
  const expected = {
    summary: clean('s'), details: 'l1\n\tl2[31mend', project: clean('p'), repo: clean('r'), branch: clean('b'), agent: clean('g'),
    tags: ['t', 'x'], refs: [{ type: 'url', value: clean('u'), repo: clean('rr') }],
  };

  test('an update removes the bytes from every field, and a project of only control characters falls back to the default', () => {
    const { id, bundle, next } = dirtyEntry(new Date(Date.now() + 5000).toISOString());
    expect(importBundle(db, { ...bundle, entries: [next] }).updated).toBe(1);
    expect(repo.get(id)).toMatchObject(expected);
    const later = { ...next, project: '\x1b\x07', updatedAt: new Date(Date.now() + 10000).toISOString() };
    expect(importBundle(db, { ...bundle, entries: [later] }).updated).toBe(1);
    expect(repo.get(id)?.project).toBe('uncategorized');
  });

  test('an insert removes the bytes from every field', () => {
    const { bundle, next } = dirtyEntry(new Date().toISOString());
    const { d: db2, r: repo2 } = open('c.db');
    try {
      expect(importBundle(db2, { ...bundle, entries: [next] }).inserted).toBe(1);
      expect(repo2.get(next.id)).toMatchObject(expected);
    } finally { db2.close(); }
  });

  test('a summary of only control characters fails the import and changes nothing', () => {
    const { id, bundle, next } = dirtyEntry(new Date(Date.now() + 5000).toISOString());
    expect(() => importBundle(db, { ...bundle, entries: [{ ...next, summary: '\x1b\x07' }] })).toThrow('Bundle entry 0 is invalid: summary');
    expect(repo.get(id)?.summary).toBe('seed');
  });
});
