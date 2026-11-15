import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { ftsTest } from '../fts5';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { InvalidQueryError } from '../../src/core';
import type { NewEntryInput } from '../../src/core';
import type { EntryRepository } from '../../src/core/repository';
import { ftsMatchExpression, likePattern } from '../../src/storage/search';

let home: string; let db: DatabaseSync; let config: Config; let repo: EntryRepository;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-find-'));
  const dbPath = path.join(home, 'gournal.db');
  db = openDb(dbPath);
  config = loadConfig(home);
  config.projectAliases = { 'gournal-old': 'gournal' };
  repo = createRepository(db, config, dbPath);
});
afterEach(() => { db.close(); fs.rmSync(home, { recursive: true, force: true }); });

const seed = (summary: string, extra: Partial<NewEntryInput> = {}) =>
  repo.add({ summary, project: 'p', source: 'cli', ...extra });
const summaries = (q: Parameters<EntryRepository['find']>[0]) => repo.find(q).map((e) => e.summary);

test('order desc and limit run in SQL', () => {
  seed('one', { createdAt: '2026-11-01T10:00:00Z' }); seed('two', { createdAt: '2026-11-02T10:00:00Z' });
  seed('three', { createdAt: '2026-11-03T10:00:00Z' });
  expect(summaries({ order: 'desc', limit: 2 })).toEqual(['three', 'two']);
  expect(summaries({})).toEqual(['one', 'two', 'three']);
});
test('project filter is case-insensitive and matches alias keys', () => {
  seed('a', { project: 'gournal' });
  seed('other', { project: 'zzz' });
  db.prepare(`INSERT INTO entries (id, created_at, updated_at, device_id, summary, kind, project, source)
    VALUES ('01LEGACY0000000000000000AA', 1, 1, 'd', 'legacy', 'done', 'gournal-old', 'cli')`).run();
  expect(summaries({ project: 'gournal' }).sort()).toEqual(['a', 'legacy']);
  expect(summaries({ project: 'Gournal' }).sort()).toEqual(['a', 'legacy']);
  // Filter differs in case from the stored name and from the alias target.
  expect(summaries({ project: 'GOURNAL-OLD' }).sort()).toEqual(['a', 'legacy']);
  db.prepare(`INSERT INTO entries (id, created_at, updated_at, device_id, summary, kind, project, source)
    VALUES ('01LEGACY0000000000000000AB', 2, 2, 'd', 'upper', 'done', 'Gournal-Old', 'cli')`).run();
  expect(summaries({ project: 'gournal' }).sort()).toEqual(['a', 'legacy', 'upper']);
});
test('kind, status, repo, and source filter', () => {
  seed('blk', { kind: 'blocker', repo: 'acme/x', source: 'mcp' });
  seed('nxt', { kind: 'next' });
  seed('done');
  const resolved = seed('blk2', { kind: 'blocker' });
  repo.resolve(resolved.id);
  expect(summaries({ kind: ['blocker', 'next'], status: 'open' }).sort()).toEqual(['blk', 'nxt']);
  expect(summaries({ repo: 'Acme/X' })).toEqual(['blk']);
  expect(summaries({ source: 'mcp' })).toEqual(['blk']);
  expect(summaries({ kind: [] })).toHaveLength(4);
});
test('includeDeleted and date bounds', () => {
  const a = seed('a', { createdAt: '2026-11-01T10:00:00Z' });
  seed('b', { createdAt: '2026-11-05T10:00:00Z' });
  repo.softDelete(a.id);
  expect(summaries({})).toEqual(['b']);
  expect(summaries({ includeDeleted: true })).toEqual(['a', 'b']);
  expect(summaries({ from: '2026-11-02T00:00:00Z', includeDeleted: true })).toEqual(['b']);
  expect(summaries({ to: '2026-11-02T00:00:00Z', includeDeleted: true })).toEqual(['a']);
});
test('every text term must match', () => {
  seed('Rebuilt the FTS index'); seed('Rebuilt the cache');
  expect(summaries({ text: 'rebuilt fts' })).toEqual(['Rebuilt the FTS index']);
});
test('text matches details too', () => {
  seed('plain summary', { details: 'contains zebra word' });
  seed('other');
  expect(summaries({ text: 'zebra' })).toEqual(['plain summary']);
});
test('text with FTS syntax characters does not throw', () => {
  seed('Fixed "quoted" OR (grouped) a-b: c*');
  for (const t of ['"quoted"', 'OR', '(grouped)', 'a-b:', 'c*', '"', 'it"s', 'a\u0000b', '\u0000', 'hello\u0000']) expect(() => repo.find({ text: t })).not.toThrow();
  expect(repo.find({ text: '"quoted"' })).toHaveLength(1);
});
ftsTest('text of only punctuation matches nothing with a live index', () => {
  seed('has a " quote');
  expect(repo.searchMode()).toBe('fts');
  expect(repo.find({ text: '"' })).toEqual([]);
});
test('a NUL inside a term still finds the cleaned term', () => {
  seed('hello world');
  if (repo.searchMode() === 'fts') expect(repo.find({ text: 'hel\u0000lo' })).toHaveLength(1);
});
ftsTest('text search falls back when the index is not live', () => {
  db.exec('DROP TRIGGER entries_fts_ai; DROP TRIGGER entries_fts_ad; DROP TRIGGER entries_fts_au');
  seed('Added after the drop');
  expect(repo.searchMode()).toBe('like');
  expect(repo.find({ text: 'after the drop' })).toHaveLength(1);
});
ftsTest('a live index uses fts', () => expect(repo.searchMode()).toBe('fts'));
test('like fallback escapes percent and underscore', () => {
  db.exec('DROP TRIGGER IF EXISTS entries_fts_ai; DROP TRIGGER IF EXISTS entries_fts_ad; DROP TRIGGER IF EXISTS entries_fts_au');
  seed('Reached 50% coverage'); seed('Reached 500 coverage'); seed('snake_case name'); seed('snakeXcase name');
  expect(repo.searchMode()).toBe('like');
  expect(summaries({ text: '50%' })).toEqual(['Reached 50% coverage']);
  expect(summaries({ text: 'snake_case' })).toEqual(['snake_case name']);
});
test('tagCounts and projectCounts honor the query and skip deleted rows', () => {
  seed('a', { project: 'x', tags: ['t1', 't2'] });
  seed('b', { project: 'x', tags: ['t1'] });
  seed('c', { project: 'y', tags: ['t2'] });
  const gone = seed('d', { project: 'y', tags: ['t1'] });
  repo.softDelete(gone.id);
  expect(repo.tagCounts()).toEqual([{ tag: 't1', count: 2 }, { tag: 't2', count: 2 }]);
  expect(repo.tagCounts({ project: 'x' })).toEqual([{ tag: 't1', count: 2 }, { tag: 't2', count: 1 }]);
  expect(repo.projectCounts()).toEqual([{ project: 'x', count: 2 }, { project: 'y', count: 1 }]);
  expect(repo.projectCounts({ tags: ['t2'] })).toEqual([{ project: 'x', count: 1 }, { project: 'y', count: 1 }]);
  expect(repo.projectCounts({ text: 'b' })).toEqual([{ project: 'x', count: 1 }]);
});
test('an invalid bound throws InvalidQueryError', () => {
  expect(() => repo.find({ from: 'soon' })).toThrow(InvalidQueryError);
  expect(() => repo.find({ limit: 0 })).toThrow(InvalidQueryError);
});
test('match expression and like pattern helpers', () => {
  expect(ftsMatchExpression(['fts', 'it"s'])).toBe('"fts"* "it""s"*');
  expect(ftsMatchExpression(['"', 'ok'])).toBe('"ok"*');
  expect(ftsMatchExpression(['"'])).toBe('');
  expect(ftsMatchExpression(['\u0000'])).toBe('');
  expect(ftsMatchExpression(['a\u0000b'])).toBe('"ab"*');
  expect(likePattern('50%')).toBe('%50\\%%');
});
