import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { importLegacy, applyPlan, renderPlanDiff } from '../../src/storage/migrate';
import type { MigrationPlan, PlanItem } from '../../src/storage/migrate';
import type { EntryRepository } from '../../src/core/repository';

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
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-plan-'));
  dbPath = path.join(home, 'gournal.db');
  db = openDb(dbPath);
  jsonPath = path.join(home, 'entries.json');
  fs.writeFileSync(jsonPath, JSON.stringify([A, B], null, 2));
  stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  remake(loadConfig(home));
  importLegacy(db, repo, config, jsonPath);
});
afterEach(() => { stderr.mockRestore(); db.close(); fs.rmSync(home, { recursive: true, force: true }); });

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
