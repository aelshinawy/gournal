import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { importLegacy, applyPlan, renderPlanDiff } from '../../src/storage/migrate';
import type { MigrationPlan, PlanItem } from '../../src/storage/migrate';
import type { EntryRepository } from '../../src/core/repository';
import { makeTmp, rmTmp } from '../helpers/tmp';

let home: string; let db: DatabaseSync; let config: Config; let repo: EntryRepository;
let jsonPath: string; let dbPath: string; let stderr: jest.SpyInstance;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const A = { timestamp: '2026-07-28T14:35:23.997Z', message: 'Shipped SBDC-1748 (PR #327). Scoped the ranking.', project: 'a', tags: ['Performance'] };
const B = { timestamp: '2026-07-29T10:00:00.000Z', message: 'Second entry', project: 'a', tags: ['sbdc-1749'] };

const remake = (c: Config) => { config = c; repo = createRepository(db, config, dbPath); };
const item = (e: { timestamp: string; message: string }, index: number, over: Partial<PlanItem> = {}): PlanItem =>
  ({ index, timestamp: e.timestamp, messageHash: sha(e.message), summary: `Reviewed ${index}`, ...over });
const plan = (...items: PlanItem[]): MigrationPlan => ({ format: 'gournal-migration-plan', version: 1, items });
const byIndex = (i: number) => {
  const row = db.prepare('SELECT entry_id FROM legacy_map WHERE legacy_index = ?').get(i) as { entry_id: string };
  return repo.get(row.entry_id)!;
};
const apply = (p: MigrationPlan, dryRun = false) => applyPlan(db, repo, config, jsonPath, p, { dryRun });

beforeEach(() => {
  home = makeTmp('gournal-plan-');
  dbPath = path.join(home, 'gournal.db');
  db = openDb(dbPath);
  jsonPath = path.join(home, 'entries.json');
  fs.writeFileSync(jsonPath, JSON.stringify([A, B], null, 2));
  stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  remake(loadConfig(home));
  importLegacy(db, repo, config, jsonPath);
});
afterEach(() => { stderr.mockRestore(); db.close(); rmTmp(home); });

test('plan replaces summaries on an already migrated database and keeps details', () => {
  const before = byIndex(0);
  const { changes } = apply(plan(item(A, 0, { summary: 'Shipped ranking' })));
  const after = byIndex(0);
  expect(after.summary).toBe('Shipped ranking');
  expect(after.details).toBe(before.details);
  expect(changes.map((c) => c.index)).toEqual([0]);
});

test('plan aliases apply to all migrated entries', () => {
  remake({ ...config, projectAliases: { a: 'b' } });
  const { changes } = apply(plan(item(A, 0)));
  expect(byIndex(0).project).toBe('b');
  expect(byIndex(1).project).toBe('b');
  expect(changes.map((c) => c.index).sort()).toEqual([0, 1]);
});

test('ticket prefix re-application moves a ticket tag to a ref', () => {
  remake({ ...config, ticketPrefixes: ['SBDC'] });
  expect(byIndex(1).tags).toContain('sbdc-1749');
  const { changes } = apply(plan());
  const e = byIndex(1);
  expect(e.tags).not.toContain('sbdc-1749');
  expect(e.refs).toEqual(expect.arrayContaining([{ type: 'jira', value: 'SBDC-1749' }]));
  expect(changes.map((c) => c.index)).toEqual([1]);
});

test('entries that do not change are not touched', () => {
  const before = byIndex(1).updatedAt;
  const { changes } = apply(plan());
  expect(changes).toEqual([]);
  expect(byIndex(1).updatedAt).toBe(before);
});

test('a mismatched plan writes nothing', () => {
  const bad = item(B, 1, { messageHash: sha('other') });
  expect(() => apply(plan(item(A, 0), bad))).toThrow('Plan item 1 does not match entries.json; nothing was written');
  expect(byIndex(0).summary).not.toBe('Reviewed 0');
});

test.each([
  ['index outside the file', (): PlanItem => item(A, 5)],
  ['timestamp mismatch', (): PlanItem => item(A, 0, { timestamp: '2026-01-01T00:00:00.000Z' })],
])('%s is rejected', (_n, make) => {
  expect(() => apply(plan(make()))).toThrow(/does not match entries.json; nothing was written/);
});

test('an item whose legacy_map row points at no entry is rejected', () => {
  const id = byIndex(0).id;
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  expect(() => apply(plan(item(A, 0)))).toThrow('Plan item 0 does not match entries.json; nothing was written');
});

test('dry run writes nothing and returns changes', () => {
  const before = byIndex(0);
  const { changes } = apply(plan(item(A, 0, { summary: 'New one' })), true);
  expect(changes).toHaveLength(1);
  expect(changes[0].before.summary).toBe(before.summary);
  expect(changes[0].after.summary).toBe('New one');
  expect(byIndex(0)).toEqual(before);
});

test('a plan summary over 120 is rejected with its index', () => {
  expect(() => apply(plan(item(A, 0, { summary: 'x'.repeat(130) })))).toThrow(/Plan item 0/);
});

test('an empty summary, bad kind, and bad tags are rejected before any write', () => {
  expect(() => apply(plan(item(A, 0), item(B, 1, { summary: '  ' })))).toThrow(/Plan item 1/);
  expect(() => apply(plan(item(A, 0), item(B, 1, { kind: 'bogus' as any })))).toThrow(/Plan item 1/);
  expect(() => apply(plan(item(A, 0), item(B, 1, { tags: [1] as any })))).toThrow(/Plan item 1/);
  expect(byIndex(0).summary).not.toBe('Reviewed 0');
});

test('not a plan', () => {
  expect(() => apply({ format: 'x', version: 1, items: [] } as any)).toThrow('Not a gournal migration plan');
  expect(() => apply({ format: 'gournal-migration-plan', version: 2, items: [] } as any)).toThrow('Not a gournal migration plan');
  expect(() => apply(null as any)).toThrow('Not a gournal migration plan');
});

test('details null clears only when the summary is the full message', () => {
  expect(() => apply(plan(item(A, 0, { details: null })))).toThrow(
    'Plan item 0 would lose text: details may only be cleared when the summary is the full message');
  apply(plan(item(B, 1, { summary: B.message, details: null })));
  expect(byIndex(1).details).toBeNull();
});

test('plan tags, project and kind replace the entry values', () => {
  apply(plan(item(A, 0, { tags: ['Alpha'], project: 'z', kind: 'next' })));
  const e = byIndex(0);
  expect(e).toMatchObject({ tags: ['alpha'], project: 'z', kind: 'next' });
});

test('renderPlanDiff shows before and after', () => {
  const { changes } = apply(plan(item(A, 0, { summary: 'Brand new' })), true);
  const md = renderPlanDiff(changes);
  expect(md).toContain('### 0 2026-07-28T14:35:23.997Z');
  expect(md).toContain('Shipped SBDC-1748 (PR #327).');
  expect(md).toContain('Brand new');
  expect(md).toMatch(/before/);
  expect(md).toMatch(/after/);
});

test('a kind change appears in the diff', () => {
  const { changes } = apply(plan(item(A, 0, { kind: 'blocker' })), true);
  expect(changes[0].before.kind).toBe('done');
  expect(changes[0].after.kind).toBe('blocker');
  expect(renderPlanDiff(changes)).toContain('kind: blocker');
});

test('a ticket-prefix change shows the jira ref in after.refs', () => {
  remake({ ...config, ticketPrefixes: ['SBDC'] });
  const { changes } = apply(plan(), true);
  expect(changes[0].before.refs).not.toContainEqual({ type: 'jira', value: 'SBDC-1749' });
  expect(changes[0].after.refs).toContainEqual({ type: 'jira', value: 'SBDC-1749' });
  expect(renderPlanDiff(changes)).toContain('jira:SBDC-1749');
});

test('after view equals the stored entry for every change on a real run', () => {
  remake({ ...config, projectAliases: { a: 'b' }, ticketPrefixes: ['SBDC'] });
  const { changes } = apply(plan(item(A, 0, { kind: 'next', tags: ['Alpha', 'sbdc-5'] })));
  expect(changes).toHaveLength(2);
  for (const c of changes) {
    const e = repo.get(c.entryId)!;
    expect({ summary: e.summary, details: e.details, kind: e.kind, project: e.project, tags: e.tags, refs: e.refs }).toEqual(c.after);
  }
});

test('a duplicate plan index is rejected', () => {
  expect(() => apply(plan(item(A, 0), item(A, 0)))).toThrow('Plan item 0 appears more than once');
});

test('a non-object plan item is rejected by position', () => {
  expect(() => apply(plan(item(A, 0), 'x' as any))).toThrow('Plan item 1 is not an object');
});

test('a failing update rolls everything back', () => {
  const orig = repo.update.bind(repo);
  let calls = 0;
  repo.update = (id, patch) => { if (++calls === 2) throw new Error('boom'); return orig(id, patch); };
  const before = repo.find();
  expect(() => apply(plan(item(A, 0), item(B, 1)))).toThrow('boom');
  expect(repo.find()).toEqual(before);
});

test('an unchanged multi-tag entry is untouched', () => {
  const e = repo.add({ summary: 's', source: 'migration', project: 'a', tags: ['x', 'y', 'z'] });
  const { changes } = apply(plan());
  expect(changes).toEqual([]);
  expect(repo.get(e.id)!.updatedAt).toBe(e.updatedAt);
});

describe('plans never lose the original text', () => {
  test('a new summary without details keeps the original message in details', () => {
    expect(byIndex(1).details).toBeNull();
    apply(plan(item(B, 1, { summary: 'Reviewed second' })));
    const e = byIndex(1);
    expect(e.summary).toBe('Reviewed second');
    expect(e.details).toBe(B.message);
  });

  test('the original message goes first, then edited details', () => {
    repo.update(byIndex(1).id, { details: 'my own note' });
    apply(plan(item(B, 1, { summary: 'Reviewed second' })));
    expect(byIndex(1).details).toBe(`${B.message}\n\nmy own note`);
  });

  test('the dry run shows the final details', () => {
    const { changes } = apply(plan(item(B, 1, { summary: 'Reviewed second' })), true);
    expect(changes[0].after.details).toBe(B.message);
    expect(byIndex(1).details).toBeNull();
  });

  test('an explicit details string that loses the message is rejected and nothing is written', () => {
    const before = repo.find({ includeDeleted: true });
    expect(() => apply(plan(item(A, 0, { summary: 'Shipped ranking' }), item(B, 1, { summary: 'Short', details: 'unrelated' })))).toThrow(
      'Plan item 1 would lose text: summary plus details must contain the original message');
    expect(repo.find({ includeDeleted: true })).toEqual(before);
  });

  test('an explicit details string that holds the message is accepted', () => {
    apply(plan(item(B, 1, { summary: 'Short', details: `Context. ${B.message}` })));
    expect(byIndex(1).details).toBe(`Context. ${B.message}`);
  });

  test('summary plus details holds the original message for every item of a mixed plan', () => {
    const C = { timestamp: '2026-08-01T10:00:00.000Z', message: 'Line one\nLine two', project: 'a', tags: [] as string[] };
    const D = { timestamp: '2026-08-02T10:00:00.000Z', message: `${'Long sentence '.repeat(12)}end`, project: 'a', tags: [] as string[] };
    fs.writeFileSync(jsonPath, JSON.stringify([A, B, C, D]));
    importLegacy(db, repo, config, jsonPath);
    const all = [A, B, C, D];
    apply(plan(
      item(A, 0, { summary: 'New A' }),
      item(B, 1, { summary: 'New B' }),
      item(C, 2, { summary: 'New C' }),
      item(D, 3, { summary: 'New D' }),
    ));
    all.forEach((src, i) => {
      const e = byIndex(i);
      expect(e.summary).toBe(`New ${'ABCD'[i]}`);
      expect(e.summary.includes(src.message.trim()) || (e.details ?? '').includes(src.message.trim())).toBe(true);
    });
  });
});

describe('pre-plan snapshot', () => {
  const snaps = () => fs.existsSync(path.join(home, 'backups'))
    ? fs.readdirSync(path.join(home, 'backups')).filter((n) => /^gournal-pre-plan-\d{8}-\d{6}(-\d+)?\.db$/.test(n)) : [];
  test('a real run writes a snapshot first and returns its path', () => {
    const r = apply(plan(item(A, 0, { summary: 'Shipped ranking' })));
    expect(snaps()).toHaveLength(1);
    expect(r.snapshot).toBe(path.join(fs.realpathSync(home), 'backups', snaps()[0]));
    const copy = new DatabaseSync(r.snapshot!);
    try { expect((copy.prepare('SELECT summary FROM entries ORDER BY created_at').all() as { summary: string }[])[0].summary).toBe('Shipped SBDC-1748 (PR #327).'); }
    finally { copy.close(); }
  });
  test('a plan that fails validation leaves no snapshot', () => {
    expect(() => apply(plan(item(A, 0), { ...item(B, 1), messageHash: 'wrong' }))).toThrow(/does not match entries.json/);
    expect(snaps()).toEqual([]);
    expect(() => apply(plan(item(A, 0, { summary: 'x'.repeat(130) })))).toThrow(/Plan item 0/);
    expect(snaps()).toEqual([]);
  });
  test('a dry run writes no snapshot', () => {
    const r = apply(plan(item(A, 0)), true);
    expect(snaps()).toEqual([]);
    expect(r.snapshot).toBeUndefined();
  });
  test('two runs in one second keep both snapshots', () => {
    apply(plan(item(A, 0, { summary: 'One' })));
    apply(plan(item(A, 0, { summary: 'Two' })));
    expect(snaps()).toHaveLength(2);
  });
});
