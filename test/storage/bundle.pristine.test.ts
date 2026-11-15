import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { importLegacy } from '../../src/storage/migrate';
import { exportBundle, importBundle } from '../../src/storage/bundle';
import type { EntryRepository } from '../../src/core/repository';

interface Side { db: DatabaseSync; repo: EntryRepository }
let home: string; let config: Config; let stderr: jest.SpyInstance; let sides: Side[];
const legacy = [
  { timestamp: '2026-07-29T10:00:00.000Z', message: 'One', project: 'a', tags: [] },
  { timestamp: '2026-07-30T10:00:00.000Z', message: 'Two', project: 'a', tags: [] },
];
const wait = (n = 15) => { const s = Date.now(); while (Date.now() - s < n) { /* ensure a later updatedAt */ } };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-pristine-'));
  config = loadConfig(home);
  fs.writeFileSync(path.join(home, 'entries.json'), JSON.stringify(legacy));
  stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  sides = [];
});
afterEach(() => { stderr.mockRestore(); for (const s of sides) s.db.close(); fs.rmSync(home, { recursive: true, force: true }); });

/** A database that has imported entries.json by itself. */
function side(name: string): Side {
  const dbPath = path.join(home, name);
  const db = openDb(dbPath);
  const repo = createRepository(db, config, dbPath);
  importLegacy(db, repo, config, path.join(home, 'entries.json'));
  const s = { db, repo };
  sides.push(s);
  return s;
}
const byText = (s: Side, text: string) => s.repo.list({ includeDeleted: true }).filter((e) => e.summary.startsWith(text));
const liveSummaries = (s: Side) => s.repo.list().map((e) => e.summary).sort();
const ship = (s: Side) => JSON.parse(JSON.stringify(exportBundle(s.db, config)));

test('an edited bundle copy beats a later raw re-import, and the raw copy is soft deleted', () => {
  const theirs = side('b.db');
  theirs.repo.update(byText(theirs, 'One')[0].id, { summary: 'One (curated)', tags: ['curated'] });
  const bundle = ship(theirs);
  wait();
  const mine = side('a.db');
  const r = importBundle(mine.db, bundle);
  expect(r.deduplicated).toBe(2);
  expect(liveSummaries(mine)).toHaveLength(2);
  expect(liveSummaries(mine)).toContain('One (curated)');
  expect(liveSummaries(mine)).not.toContain('One');
  expect(mine.repo.list().find((e) => e.summary === 'One (curated)')!.tags).toEqual(['curated']);
  expect(byText(mine, 'One').filter((e) => e.deletedAt !== null)).toHaveLength(1);
  expect(mine.repo.list({ includeDeleted: true })).toHaveLength(4);
});

test('a deleted bundle copy keeps the entry deleted when the local copy is a pristine re-import', () => {
  const theirs = side('b.db');
  theirs.repo.softDelete(byText(theirs, 'One')[0].id);
  const bundle = ship(theirs);
  wait();
  const mine = side('a.db');
  importBundle(mine.db, bundle);
  expect(liveSummaries(mine)).toEqual(['Two']);
  expect(byText(mine, 'One').every((e) => e.deletedAt !== null)).toBe(true);
});

test('both copies pristine: one survives', () => {
  const theirs = side('b.db');
  const bundle = ship(theirs);
  const mine = side('a.db');
  const r = importBundle(mine.db, bundle);
  expect(r.deduplicated).toBe(2);
  expect(liveSummaries(mine)).toEqual(['One', 'Two']);
  const ids = mine.db.prepare('SELECT entry_id FROM legacy_map ORDER BY legacy_index').all() as { entry_id: string }[];
  for (const [i, text] of ['One', 'Two'].entries()) {
    const all = byText(mine, text);
    expect(all).toHaveLength(2);
    const winner = all.reduce((a, b) => (a.id < b.id ? a : b));
    expect(ids[i].entry_id).toBe(winner.id);
    expect(winner.deletedAt).toBeNull();
  }
});

test('both copies edited: the later edit wins', () => {
  const theirs = side('b.db');
  theirs.repo.update(byText(theirs, 'One')[0].id, { summary: 'One theirs' });
  const bundle = ship(theirs);
  const mine = side('a.db');
  wait();
  mine.repo.update(byText(mine, 'One')[0].id, { summary: 'One mine' });
  importBundle(mine.db, bundle);
  expect(liveSummaries(mine)).toContain('One mine');
  expect(liveSummaries(mine)).not.toContain('One theirs');

  // The other way round: the bundle edit is the later one.
  const theirs2 = side('c.db');
  theirs2.repo.update(byText(theirs2, 'Two')[0].id, { summary: 'Two theirs' });
  const mine2 = side('d.db');
  wait();
  mine2.repo.update(byText(mine2, 'Two')[0].id, { summary: 'Two mine' });
  wait();
  theirs2.repo.update(byText(theirs2, 'Two theirs')[0].id, { summary: 'Two theirs later' });
  importBundle(mine2.db, ship(theirs2));
  expect(liveSummaries(mine2)).toContain('Two theirs later');
  expect(liveSummaries(mine2)).not.toContain('Two mine');
});

test('a local edit beats a pristine bundle copy', () => {
  const theirs = side('b.db');
  const bundle = ship(theirs);
  const mine = side('a.db');
  mine.repo.update(byText(mine, 'One')[0].id, { summary: 'One mine' });
  importBundle(mine.db, bundle);
  expect(liveSummaries(mine)).toContain('One mine');
  expect(liveSummaries(mine)).not.toContain('One');
});

test('the bundle carries importedAt, and an old bundle without it still imports', () => {
  const theirs = side('b.db');
  const bundle = ship(theirs);
  expect(bundle.legacyMap).toHaveLength(2);
  for (const r of bundle.legacyMap) expect(typeof r.importedAt).toBe('string');
  for (const r of bundle.legacyMap) delete r.importedAt;
  const mine = side('a.db');
  expect(() => importBundle(mine.db, bundle)).not.toThrow();
  expect(liveSummaries(mine)).toHaveLength(2);
  bundle.legacyMap[0].importedAt = 'nope';
  expect(() => importBundle(mine.db, bundle)).toThrow('Bundle legacyMap row 0 is invalid');
});

test('importLegacy stores imported_at equal to the entry updated_at', () => {
  const mine = side('a.db');
  const rows = mine.db.prepare('SELECT m.imported_at AS i, e.updated_at AS u FROM legacy_map m JOIN entries e ON e.id = m.entry_id').all() as { i: number; u: number }[];
  expect(rows).toHaveLength(2);
  for (const r of rows) expect(r.i).toBe(r.u);
});

test('a pre-v2 database migrates with NULL imported_at and counts as not pristine', () => {
  const dbPath = path.join(home, 'a.db');
  const old = openDb(dbPath);
  const oldRepo = createRepository(old, config, dbPath);
  importLegacy(old, oldRepo, config, path.join(home, 'entries.json'));
  // Turn it back into a v1 database.
  old.exec('ALTER TABLE legacy_map DROP COLUMN imported_at');
  old.exec('DELETE FROM schema_version WHERE version = 2');
  old.close();
  const db = openDb(dbPath);
  const mine = { db, repo: createRepository(db, config, dbPath) };
  sides.push(mine);
  expect(db.prepare('SELECT MAX(version) AS v FROM schema_version').get()).toEqual({ v: 2 });
  expect(db.prepare('SELECT imported_at FROM legacy_map').all()).toEqual([{ imported_at: null }, { imported_at: null }]);
  // The bundle side is pristine and later. The local NULL row is not pristine, so the bundle copy loses.
  wait();
  const theirs = side('b.db');
  const localIds = mine.repo.list().map((e) => e.id).sort();
  importBundle(mine.db, ship(theirs));
  expect(mine.repo.list().map((e) => e.id).sort()).toEqual(localIds);
});

// With the clock frozen, an edit lands in the same millisecond as the legacy import. The edit must
// still be told apart from a pristine copy. The side with the smaller id plays "theirs", so a wrong
// pristine check always loses the local edit (a tie falls to the smaller id).
describe('an edit in the same millisecond as the import', () => {
  let now: jest.SpyInstance;
  beforeEach(() => { now = jest.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000); });
  afterEach(() => { now.mockRestore(); });

  function pair(): { theirs: Side; mine: Side } {
    const x = side('x.db');
    const y = side('y.db');
    const [theirs, mine] = byText(x, 'One')[0].id < byText(y, 'One')[0].id ? [x, y] : [y, x];
    return { theirs, mine };
  }

  test('update still beats a pristine bundle copy', () => {
    const { theirs, mine } = pair();
    const bundle = ship(theirs);
    mine.repo.update(byText(mine, 'One')[0].id, { summary: 'One mine' });
    importBundle(mine.db, bundle);
    expect(liveSummaries(mine)).toContain('One mine');
    expect(liveSummaries(mine)).not.toContain('One');
  });

  test('restore still beats a pristine bundle copy', () => {
    const { theirs, mine } = pair();
    const bundle = ship(theirs);
    const id = byText(mine, 'One')[0].id;
    mine.repo.softDelete(id);
    mine.repo.restore(id);
    importBundle(mine.db, bundle);
    expect(mine.repo.get(id)?.deletedAt).toBeNull();
    expect(liveSummaries(mine)).toEqual(['One', 'Two']);
    expect(byText(mine, 'One').filter((e) => e.deletedAt === null).map((e) => e.id)).toEqual([id]);
  });

  test('update to a blocker then resolve still beats a pristine bundle copy', () => {
    const { theirs, mine } = pair();
    const bundle = ship(theirs);
    const id = byText(mine, 'One')[0].id;
    mine.repo.update(id, { kind: 'blocker' });
    mine.repo.resolve(id);
    importBundle(mine.db, bundle);
    expect(mine.repo.get(id)).toMatchObject({ deletedAt: null, kind: 'blocker', status: 'resolved' });
    expect(byText(mine, 'One').filter((e) => e.deletedAt === null).map((e) => e.id)).toEqual([id]);
  });
});
