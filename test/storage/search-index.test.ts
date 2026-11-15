import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { hasFts5, resetSearchIndexNotice, rebuildSearchIndex, searchIndexLive } from '../../src/storage/schema';
import { loadConfig, type Config } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';
import { exportBundle, importBundle } from '../../src/storage/bundle';
import { ftsTest } from '../fts5';
import { runIn } from '../helpers/run-cli';

// GOURNAL_DISABLE_FTS5=1 makes the detection function report "no FTS5", like an official Linux Node build.
const FLAG = 'GOURNAL_DISABLE_FTS5';
let dir: string; let file: string; let config: Config;
const outerFlag = process.env[FLAG];
const restoreFlag = () => { if (outerFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = outerFlag; };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-search-'));
  file = path.join(dir, 'gournal.db');
  config = loadConfig(dir);
  restoreFlag();
});
afterEach(() => { restoreFlag(); fs.rmSync(dir, { recursive: true, force: true }); });

const realFts5 = (d: DatabaseSync): boolean => {
  try { d.exec('CREATE VIRTUAL TABLE temp.t5 USING fts5(a)'); return true; } catch { return false; }
};
const withoutFts = <T>(fn: () => T): T => {
  process.env[FLAG] = '1';
  try { return fn(); } finally { restoreFlag(); }
};
const ftsTriggers = (d: DatabaseSync) =>
  (d.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'entries_fts_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const ftsTable = (d: DatabaseSync) => d.prepare("SELECT name FROM sqlite_master WHERE name = 'entries_fts'").get() !== undefined;
const hits = (d: DatabaseSync, q: string) =>
  (d.prepare('SELECT e.id FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ? ORDER BY e.id').all(q) as { id: string }[]).map((r) => r.id);
const base = { project: 'p', source: 'cli' as const };

test('(a) a fresh database opens without FTS and add, update, delete and bundle import work', () => {
  withoutFts(() => {
    const db = openDb(file);
    try {
      expect(ftsTable(db)).toBe(false);
      expect(ftsTriggers(db)).toEqual([]);
      const repo = createRepository(db, config, file);
      const e = repo.add({ summary: 'alpha', details: 'first', ...base });
      repo.update(e.id, { summary: 'beta' });
      expect(repo.get(e.id)!.summary).toBe('beta');
      const gone = repo.add({ summary: 'temp', ...base });
      repo.softDelete(gone.id);
      db.prepare('DELETE FROM entries WHERE id = ?').run(gone.id);

      const bundle = exportBundle(db, config);
      const other = path.join(dir, 'other.db');
      const db2 = openDb(other);
      try {
        expect(importBundle(db2, JSON.parse(JSON.stringify(bundle)))).toMatchObject({ inserted: 1 });
        expect(createRepository(db2, config, other).get(e.id)!.summary).toBe('beta');
        expect(ftsTable(db2)).toBe(false);
      } finally { db2.close(); }
    } finally { db.close(); }
  });
});

ftsTest('(b) a database created with FTS and opened without it loses its triggers and keeps writing', () => {
  const first = openDb(file);
  const e = createRepository(first, config, file).add({ summary: 'alpha', ...base });
  first.close();

  withoutFts(() => {
    const db = openDb(file);
    try {
      expect(ftsTriggers(db)).toEqual([]);
      // The table stays. Only the triggers go.
      expect(ftsTable(db)).toBe(true);
      const repo = createRepository(db, config, file);
      repo.update(e.id, { summary: 'beta' });
      const f = repo.add({ summary: 'gamma', ...base });
      db.prepare('DELETE FROM entries WHERE id = ?').run(f.id);
      expect(repo.get(e.id)!.summary).toBe('beta');
    } finally { db.close(); }
  });
});

ftsTest('(c) an FTS opener does not recreate dropped triggers, and writes work in both modes', () => {
  const first = openDb(file);
  const id = createRepository(first, config, file).add({ summary: 'alpha', ...base }).id;
  first.close();
  withoutFts(() => openDb(file).close());

  const db = openDb(file);
  try {
    expect(ftsTriggers(db)).toEqual([]);
    expect(ftsTable(db)).toBe(true);
    createRepository(db, config, file).update(id, { summary: 'beta' });
    createRepository(db, config, file).add({ summary: 'gamma', ...base });
  } finally { db.close(); }

  withoutFts(() => {
    const d = openDb(file);
    try { createRepository(d, config, file).update(id, { summary: 'delta' }); } finally { d.close(); }
  });
});

ftsTest('a no-FTS opener prints one notice per process when it drops the triggers', () => {
  const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    resetSearchIndexNotice();
    for (const name of ['a.db', 'b.db']) {
      const f = path.join(dir, name);
      openDb(f).close();
      withoutFts(() => openDb(f).close());
    }
    const notices = write.mock.calls.filter((c) => String(c[0]).includes('full-text index disabled'));
    expect(notices).toHaveLength(1);
    expect(String(notices[0][0])).toBe('gournal: full-text index disabled (this Node build has no FTS5)\n');
  } finally { write.mockRestore(); }
});

test('GOURNAL_DISABLE_FTS5 is active only when it equals 1', () => {
  process.env[FLAG] = '0';
  const db = new DatabaseSync(':memory:');
  try { expect(hasFts5(db)).toBe(realFts5(db)); } finally { db.close(); }
});

ftsTest('a database at schema v2 that already has entries_fts and triggers opens as a no-op', () => {
  const first = openDb(file);
  createRepository(first, config, file).add({ summary: 'alpha', ...base });
  first.close();
  const before = fs.readFileSync(file);
  const db = openDb(file);
  try {
    expect(ftsTriggers(db)).toEqual(['entries_fts_ad', 'entries_fts_ai', 'entries_fts_au']);
    expect(hits(db, 'alpha')).toHaveLength(1);
  } finally { db.close(); }
  expect(fs.readFileSync(file).equals(before)).toBe(true);
});

ftsTest('opening an up-to-date database with FTS takes no write lock', () => {
  openDb(file).close();
  const holder = openDb(file);
  holder.exec('BEGIN IMMEDIATE');
  try { openDb(file).close(); } finally { holder.exec('ROLLBACK'); holder.close(); }
});

test('opening an up-to-date database without FTS takes no write lock', () => {
  withoutFts(() => {
    openDb(file).close();
    const holder = openDb(file);
    holder.exec('BEGIN IMMEDIATE');
    try { openDb(file).close(); } finally { holder.exec('ROLLBACK'); holder.close(); }
  });
});

// Builds the stray state: triggers present, entries_fts table absent. Needs FTS5 to create it.
const makeStray = (): string => {
  const d = openDb(file);
  const id = createRepository(d, config, file).add({ summary: 'first row', ...base }).id;
  d.exec('DROP TABLE entries_fts');
  d.close();
  return id;
};

ftsTest('stray triggers without the table are dropped on open', () => {
  makeStray();
  withoutFts(() => {
    const db = openDb(file);
    try {
      expect(ftsTriggers(db)).toEqual([]);
      expect(ftsTable(db)).toBe(false);
      expect(() => createRepository(db, config, file).add({ summary: 'writes work', ...base })).not.toThrow();
    } finally { db.close(); }
  });
});

ftsTest('stray triggers are replaced by a full index when FTS5 exists', () => {
  makeStray();
  const db = openDb(file);
  try {
    expect(ftsTable(db)).toBe(true);
    expect(ftsTriggers(db)).toEqual(['entries_fts_ad', 'entries_fts_ai', 'entries_fts_au']);
    expect(searchIndexLive(db)).toBe(true);
    expect(hits(db, 'first')).toHaveLength(1);
    const repo = createRepository(db, config, file);
    repo.add({ summary: 'second row', ...base });
    expect(hits(db, 'second')).toHaveLength(1);
  } finally { db.close(); }
});

ftsTest('a table without triggers stays alone on open', () => {
  const d = openDb(file);
  createRepository(d, config, file).add({ summary: 'alpha', ...base });
  for (const t of ['entries_fts_ad', 'entries_fts_ai', 'entries_fts_au']) d.exec(`DROP TRIGGER ${t}`);
  d.close();
  const db = openDb(file);
  try {
    expect(ftsTable(db)).toBe(true);
    expect(ftsTriggers(db)).toEqual([]);
  } finally { db.close(); }
});

ftsTest('rebuild restores a live index over all rows', () => {
  const d = openDb(file);
  const repo = createRepository(d, config, file);
  repo.add({ summary: 'old row', ...base });
  for (const t of ['entries_fts_ad', 'entries_fts_ai', 'entries_fts_au']) d.exec(`DROP TRIGGER ${t}`);
  repo.add({ summary: 'newer zebra', ...base });
  repo.add({ summary: 'newest zebra', ...base });
  expect(searchIndexLive(d)).toBe(false);
  expect(rebuildSearchIndex(d)).toEqual({ indexed: 3 });
  expect(searchIndexLive(d)).toBe(true);
  expect(hits(d, 'zebra')).toHaveLength(2);
  expect(repo.find({ text: 'zebra' })).toHaveLength(2);
  d.close();
});

test('rebuild refuses without FTS5', async () => {
  const msg = 'This Node build has no FTS5; the search index cannot be rebuilt.';
  withoutFts(() => {
    const db = openDb(file);
    try { expect(() => rebuildSearchIndex(db)).toThrow(msg); } finally { db.close(); }
  });
  process.env[FLAG] = '1';
  try {
    const r = await runIn(dir, ['index', 'rebuild']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(msg);
  } finally { restoreFlag(); }
});

ftsTest('the CLI rebuilds the index and prints the count', async () => {
  const d = openDb(file);
  createRepository(d, config, file).add({ summary: 'alpha', ...base });
  d.close();
  const r = await runIn(dir, ['index', 'rebuild']);
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('Search index rebuilt: 1 entries.');
});

test('the rebuild help text carries the warning', async () => {
  const r = await runIn(dir, ['index', 'rebuild', '--help']);
  expect(r.stdout.replace(/\s+/g, ' ')).toContain('Run it only when every gournal process uses a Node build with FTS5.');
});
