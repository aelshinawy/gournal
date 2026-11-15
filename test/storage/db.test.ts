import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, CorruptDatabaseError } from '../../src/storage/db';
import { hasFts5, ftsTest } from '../fts5';

let dir: string; let file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-db-')); file = path.join(dir, 'gournal.db'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ins = (db: any, id: string, summary: string, details: string | null = null) =>
  db.prepare('INSERT INTO entries (id, created_at, updated_at, device_id, summary, details) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'D', summary, details);
const search = (db: any, q: string) =>
  db.prepare('SELECT e.id FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ? ORDER BY e.id').all(q).map((r: any) => r.id);

test('openDb creates every table and records the schema version', () => {
  const db = openDb(file);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all().map((r: any) => r.name);
  expect(names).toEqual(expect.arrayContaining(['entries', 'entry_tags', 'entry_refs', 'activity', 'links', 'legacy_map', 'sync_state', 'schema_version']));
  if (hasFts5) expect(names).toContain('entries_fts');
  expect(db.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 2 });
  db.close();
});
test('openDb uses WAL and sets pragmas', () => {
  const db = openDb(file);
  expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
  db.close();
});
test('openDb creates the folder', () => {
  const db = openDb(path.join(dir, 'a', 'b', 'gournal.db'));
  db.close();
  expect(fs.existsSync(path.join(dir, 'a', 'b', 'gournal.db'))).toBe(true);
});
test('migrateSchema is idempotent', () => {
  const db = openDb(file); db.close();
  const again = openDb(file);
  expect(again.prepare('SELECT COUNT(*) AS n FROM schema_version').get()).toEqual({ n: 2 });
  again.close();
});
test('refuses a file that is not a database', () => {
  fs.writeFileSync(file, Buffer.alloc(4096));
  expect(() => openDb(file)).toThrow(CorruptDatabaseError);
  expect(fs.readFileSync(file).equals(Buffer.alloc(4096))).toBe(true);
});
test('refuses a text file and reports the latest backup', () => {
  fs.writeFileSync(file, 'this is definitely not a sqlite database, but it is long enough '.repeat(100));
  fs.mkdirSync(path.join(dir, 'backups'));
  fs.writeFileSync(path.join(dir, 'backups', 'gournal-2026-11-14.db'), 'x');
  fs.writeFileSync(path.join(dir, 'backups', 'gournal-2026-11-15.db'), 'x');
  let err: any;
  try { openDb(file); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(CorruptDatabaseError);
  expect(err.path).toBe(file);
  expect(err.latestBackup).toBe(path.join(dir, 'backups', 'gournal-2026-11-15.db'));
  expect(err.message).toBe(`Database ${file} is not valid. Latest backup: ${err.latestBackup}. Gournal did not change the file. To restore, stop all gournal processes, move gournal.db, gournal.db-wal and gournal.db-shm aside, then copy the backup to gournal.db.`);
});
test('with no backups the message says none', () => {
  fs.writeFileSync(file, Buffer.alloc(4096));
  let err: any;
  try { openDb(file); } catch (e) { err = e; }
  expect(err.latestBackup).toBeNull();
  expect(err.message).toContain('Latest backup: none.');
});
ftsTest('FTS stays in sync on insert, update of summary and details, and delete', () => {
  const db = openDb(file);
  ins(db, 'A', 'alpha rocket', 'launch pad');
  ins(db, 'B', 'beta rocket');
  expect(search(db, 'rocket')).toEqual(['A', 'B']);
  expect(search(db, 'launch')).toEqual(['A']);

  db.prepare('UPDATE entries SET summary = ? WHERE id = ?').run('gamma satellite', 'A');
  expect(search(db, 'alpha')).toEqual([]);
  expect(search(db, 'satellite')).toEqual(['A']);
  expect(search(db, 'rocket')).toEqual(['B']);
  expect(search(db, 'launch')).toEqual(['A']);

  db.prepare('UPDATE entries SET details = ? WHERE id = ?').run('orbit insertion', 'A');
  expect(search(db, 'launch')).toEqual([]);
  expect(search(db, 'orbit')).toEqual(['A']);

  db.prepare('UPDATE entries SET status = ? WHERE id = ?').run('done', 'A');
  expect(search(db, 'satellite')).toEqual(['A']);

  db.prepare('DELETE FROM entries WHERE id = ?').run('A');
  expect(search(db, 'satellite')).toEqual([]);
  expect(search(db, 'orbit')).toEqual([]);
  expect(search(db, 'rocket')).toEqual(['B']);
  db.close();
});

test('STRICT tables reject ISO text in an INTEGER timestamp column', () => {
  const db = openDb(file);
  expect(() => db.prepare("INSERT INTO entries (id, created_at, updated_at, device_id, summary) VALUES ('X', '2026-01-01T00:00:00Z', 1, 'D', 's')").run()).toThrow();
  db.close();
});
test('every regular table is STRICT', () => {
  const db = openDb(file);
  const rows = db.prepare("SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name IN ('entries','entry_tags','entry_refs','activity','links','legacy_map','sync_state','schema_version')").all() as any[];
  expect(rows).toHaveLength(8);
  expect(rows.every((r) => r.strict === 1)).toBe(true);
  db.close();
});
test('activity dedupes with the default repo', () => {
  const db = openDb(file);
  const q = "INSERT OR IGNORE INTO activity (id, created_at, updated_at, device_id, type, occurred_at, external_id) VALUES (?, 1, 1, 'D', 'pr', 1, '12')";
  db.prepare(q).run('A1'); db.prepare(q).run('A2');
  expect(db.prepare('SELECT COUNT(*) AS n FROM activity').get()).toEqual({ n: 1 });
  db.close();
});
test('links carries updated_at and device_id', () => {
  const db = openDb(file);
  const cols = db.prepare("SELECT name FROM pragma_table_info('links')").all().map((r: any) => r.name);
  expect(cols).toEqual(expect.arrayContaining(['updated_at', 'device_id', 'deleted_at']));
  db.close();
});
test('a database already at the current version opens without a write lock', () => {
  openDb(file).close();
  const holder = openDb(file);
  holder.exec('BEGIN IMMEDIATE');
  const second = openDb(file);
  expect(second.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({ version: 2 });
  second.close();
  holder.exec('ROLLBACK');
  holder.close();
});

test('the latest backup ignores names that are not daily backups', () => {
  fs.writeFileSync(file, Buffer.alloc(4096));
  const b = path.join(dir, 'backups');
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, 'gournal-2026-11-14.db'), 'x');
  fs.writeFileSync(path.join(b, 'gournal-2026-11-15.db'), 'x');
  fs.writeFileSync(path.join(b, 'gournal-2026-11-16.db.123.abc.tmp'), 'x');
  fs.writeFileSync(path.join(b, 'gournal-pre-plan-20261117-101010.db'), 'x');
  let err: any;
  try { openDb(file); } catch (e) { err = e; }
  expect(err.latestBackup).toBe(path.join(b, 'gournal-2026-11-15.db'));
});
