import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, CorruptDatabaseError } from '../../src/storage/db';

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
  expect(names).toEqual(expect.arrayContaining(['entries', 'entry_tags', 'entry_refs', 'activity', 'links', 'legacy_map', 'sync_state', 'schema_version', 'entries_fts']));
  expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 1 });
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
  expect(again.prepare('SELECT COUNT(*) AS n FROM schema_version').get()).toEqual({ n: 1 });
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
  fs.writeFileSync(path.join(dir, 'backups', 'a.db'), 'x');
  fs.writeFileSync(path.join(dir, 'backups', 'b.db'), 'x');
  let err: any;
  try { openDb(file); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(CorruptDatabaseError);
  expect(err.path).toBe(file);
  expect(err.latestBackup).toBe(path.join(dir, 'backups', 'b.db'));
  expect(err.message).toBe(`Database ${file} is not valid. Latest backup: ${err.latestBackup}. Gournal did not change the file.`);
});
test('with no backups the message says none', () => {
  fs.writeFileSync(file, Buffer.alloc(4096));
  let err: any;
  try { openDb(file); } catch (e) { err = e; }
  expect(err.latestBackup).toBeNull();
  expect(err.message).toContain('Latest backup: none.');
});
test('FTS stays in sync on insert, update of summary and details, and delete', () => {
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
