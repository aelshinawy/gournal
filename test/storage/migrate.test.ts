import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { importLegacy, legacyKey, mechanicalEntry } from '../../src/storage/migrate';
import type { EntryRepository } from '../../src/core/repository';

let home: string; let db: DatabaseSync; let config: Config; let repo: EntryRepository; let jsonPath: string;
let stderr: jest.SpyInstance;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const fileHash = () => sha(fs.readFileSync(jsonPath, 'utf8'));
const mapRows = () => db.prepare('SELECT * FROM legacy_map ORDER BY legacy_index').all() as any[];
const errText = () => stderr.mock.calls.map((c) => String(c[0])).join('');

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-migrate-'));
  config = { ...loadConfig(home), ticketPrefixes: ['sbdc'] };
  const dbPath = path.join(home, 'gournal.db');
  db = openDb(dbPath);
  repo = createRepository(db, config, dbPath);
  jsonPath = path.join(home, 'entries.json');
  stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => { stderr.mockRestore(); db.close(); fs.rmSync(home, { recursive: true, force: true }); });

const writeLegacy = (items: unknown[]) => fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2));
const legacyA = { timestamp: '2026-07-28T14:35:23.997Z', message: 'Shipped SBDC-1748 (PR #327). Scoped the ranking.', project: 'tcb', tags: ['Performance', 'SBDC-1748'] };
const legacyB = { timestamp: '2026-07-29T10:00:00.000Z', message: 'Second entry', project: 'tcb', tags: [] };

test('migrates every legacy entry exactly once with no text lost', () => {
  writeLegacy([legacyA]);
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 1, alreadyPresent: 0 });
  const [e] = repo.list();
  expect(e).toMatchObject({ summary: 'Shipped SBDC-1748 (PR #327).', source: 'migration', kind: 'done',
    createdAt: '2026-07-28T14:35:23.997Z', tags: ['performance'], project: 'tcb' });
  expect(e.refs).toEqual(expect.arrayContaining([{ type: 'jira', value: 'SBDC-1748' }, { type: 'pr', value: '327' }]));
  expect(`${e.summary} ${e.details ?? ''}`).toContain('Scoped the ranking.');
  expect(e.details).toBe(legacyA.message);
  expect(errText()).toBe('gournal: imported 1 entries from entries.json\n');
});

test('legacy_map stores the timestamp as written, the sha256 of the message, and the index', () => {
  writeLegacy([legacyA, legacyB]);
  importLegacy(db, repo, config, jsonPath);
  const rows = mapRows();
  expect(rows.map((r) => [r.legacy_index, r.timestamp, r.message_hash, r.occurrence])).toEqual([
    [0, legacyA.timestamp, sha(legacyA.message), 0],
    [1, legacyB.timestamp, sha(legacyB.message), 0],
  ]);
  expect(rows[0].entry_id).toBe(repo.list()[0].id);
});

test('second import is a no-op', () => {
  writeLegacy([legacyA]);
  importLegacy(db, repo, config, jsonPath);
  stderr.mockClear();
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 0, alreadyPresent: 1 });
  expect(repo.list()).toHaveLength(1);
  expect(errText()).toBe('');
});

test('late writes are imported', () => {
  writeLegacy([legacyA]);
  importLegacy(db, repo, config, jsonPath);
  writeLegacy([legacyA, legacyB]);
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 1, alreadyPresent: 1 });
  expect(repo.list()).toHaveLength(2);
});

test('an old undo that shortened the file imports nothing and deletes nothing', () => {
  writeLegacy([legacyA, legacyB]);
  importLegacy(db, repo, config, jsonPath);
  writeLegacy([legacyA]);
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 0, alreadyPresent: 1 });
  expect(repo.list()).toHaveLength(2);
  expect(mapRows()).toHaveLength(2);
});

test('duplicate legacy entries both migrate with occurrences 0 and 1', () => {
  writeLegacy([legacyB, legacyB]);
  expect(importLegacy(db, repo, config, jsonPath).imported).toBe(2);
  expect(repo.list()).toHaveLength(2);
  expect(mapRows().map((r) => r.occurrence)).toEqual([0, 1]);
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 0, alreadyPresent: 2 });
});

test('a third duplicate appended later imports as occurrence 2', () => {
  writeLegacy([legacyB, legacyB]);
  importLegacy(db, repo, config, jsonPath);
  writeLegacy([legacyB, legacyB, legacyB]);
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 1, alreadyPresent: 2 });
  expect(mapRows().map((r) => r.occurrence)).toEqual([0, 1, 2]);
});

test('missing file is a no-op', () => {
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 0, alreadyPresent: 0 });
  expect(errText()).toBe('');
});

test('corrupt legacy file does not block the database', () => {
  fs.writeFileSync(jsonPath, '[{"x"');
  expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 0, alreadyPresent: 0 });
  expect(errText()).toMatch(/^gournal: entries\.json is not valid; legacy import skipped \(Journal file .* is not valid\. .*\)\n$/);
  expect(repo.add({ summary: 's', project: 'p', source: 'cli' }).id).toBeTruthy();
  fs.writeFileSync(jsonPath, JSON.stringify([legacyA]));
  expect(importLegacy(db, repo, config, jsonPath).imported).toBe(1);
});

describe('malformed items import with defaults', () => {
  test('blank message', () => {
    writeLegacy([{ timestamp: '2026-01-01T00:00:00.000Z', message: '   ', project: 'p', tags: [] }]);
    importLegacy(db, repo, config, jsonPath);
    expect(repo.list()[0]).toMatchObject({ summary: '(no message)', details: null });
  });
  test('missing or non-string project becomes uncategorized', () => {
    writeLegacy([
      { timestamp: '2026-01-01T00:00:00.000Z', message: 'a', tags: [] },
      { timestamp: '2026-01-02T00:00:00.000Z', message: 'b', project: 5, tags: [] },
    ]);
    importLegacy(db, repo, config, jsonPath);
    expect(repo.list().map((e) => e.project)).toEqual(['uncategorized', 'uncategorized']);
  });
  test('non-array tags become empty and non-string tags are dropped', () => {
    writeLegacy([
      { timestamp: '2026-01-01T00:00:00.000Z', message: 'a', project: 'p', tags: 'x' },
      { timestamp: '2026-01-02T00:00:00.000Z', message: 'b', project: 'p', tags: ['ok', 3, null, { a: 1 }] },
      { timestamp: '2026-01-03T00:00:00.000Z', message: 'c', project: 'p' },
    ]);
    importLegacy(db, repo, config, jsonPath);
    expect(repo.list().map((e) => e.tags)).toEqual([[], ['ok'], []]);
  });
  test('invalid timestamp uses import time, warns once, and keeps the written key', () => {
    writeLegacy([{ timestamp: 'not a date', message: 'a', project: 'p', tags: [] }]);
    const before = Date.now();
    importLegacy(db, repo, config, jsonPath);
    const [e] = repo.list();
    expect(Date.parse(e.createdAt)).toBeGreaterThanOrEqual(before);
    expect(errText()).toContain('gournal: legacy entry 0 has an invalid timestamp; using import time\n');
    expect(mapRows()[0].timestamp).toBe('not a date');
    expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 0, alreadyPresent: 1 });
  });
  test('a missing timestamp and a non-object item still import', () => {
    writeLegacy([{ message: 'no ts', project: 'p', tags: [] }, null, 'str']);
    expect(importLegacy(db, repo, config, jsonPath).imported).toBe(3);
    expect(repo.list()).toHaveLength(3);
    expect(importLegacy(db, repo, config, jsonPath)).toEqual({ imported: 0, alreadyPresent: 3 });
  });
  test('an over-long message with no sentence break still imports with a valid summary', () => {
    const message = 'x'.repeat(500);
    writeLegacy([{ timestamp: '2026-01-01T00:00:00.000Z', message, project: 'p', tags: [] }]);
    importLegacy(db, repo, config, jsonPath);
    const [e] = repo.list();
    expect(Array.from(e.summary).length).toBeLessThanOrEqual(120);
    expect(e.details).toBe(message);
  });
});

test('legacyKey numbers occurrences per (timestamp, message) pair in file order', () => {
  const keys = legacyKey([legacyA, legacyB, legacyA, { ...legacyA, timestamp: 'other' }] as any);
  expect(keys.map((k) => [k.index, k.timestamp, k.occurrence])).toEqual([
    [0, legacyA.timestamp, 0], [1, legacyB.timestamp, 0], [2, legacyA.timestamp, 1], [3, 'other', 0],
  ]);
  expect(keys[0].messageHash).toBe(sha(legacyA.message));
});

test('mechanicalEntry applies the migration rules', () => {
  expect(mechanicalEntry(legacyA, config)).toMatchObject({
    summary: 'Shipped SBDC-1748 (PR #327).', kind: 'done', source: 'migration', project: 'tcb',
    createdAt: '2026-07-28T14:35:23.997Z', tags: ['performance'],
  });
});

test('a failure mid-import leaves zero entries and zero legacy_map rows', () => {
  writeLegacy([1, 2, 3, 4, 5].map((n) => ({ timestamp: `2026-01-0${n}T00:00:00.000Z`, message: `m${n}`, project: 'p', tags: [] })));
  let calls = 0;
  const failing: EntryRepository = { ...repo, add: (input) => {
    if (++calls === 3) throw new Error('boom');
    return repo.add(input);
  } };
  expect(() => importLegacy(db, failing, config, jsonPath)).toThrow('boom');
  expect(repo.list({ includeDeleted: true })).toHaveLength(0);
  expect(mapRows()).toHaveLength(0);
  expect(importLegacy(db, repo, config, jsonPath).imported).toBe(5);
});

test('entries.json is never modified', () => {
  writeLegacy([legacyA, legacyB, legacyB]);
  const h = fileHash();
  importLegacy(db, repo, config, jsonPath);
  importLegacy(db, repo, config, jsonPath);
  expect(fileHash()).toBe(h);
  fs.writeFileSync(jsonPath, '[{"x"');
  const corrupt = fileHash();
  importLegacy(db, repo, config, jsonPath);
  expect(fileHash()).toBe(corrupt);
});
