import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { backupDbIfNeeded } from '../../src/storage/backup';

let dir: string; let file: string; let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-bak-'));
  file = path.join(dir, 'gournal.db');
  db = openDb(file);
  db.prepare('INSERT INTO entries (id, created_at, updated_at, device_id, summary, details) VALUES (?, 1, 1, ?, ?, ?)')
    .run('E1', 'D', 'findable zebra', null);
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('an empty journal makes no backup', () => {
  db.exec('DELETE FROM entries');
  expect(backupDbIfNeeded(db, file, new Date(2026, 10, 15))).toBeNull();
  expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
});
test('backs up once per local day', () => {
  expect(backupDbIfNeeded(db, file, new Date(2026, 10, 15, 9))).toBe(path.join(dir, 'backups', 'gournal-2026-11-15.db'));
  expect(backupDbIfNeeded(db, file, new Date(2026, 10, 15, 23))).toBeNull();
  expect(fs.readdirSync(path.join(dir, 'backups'))).toEqual(['gournal-2026-11-15.db']);
});
test('keeps the newest 7 backups', () => {
  for (let d = 1; d <= 9; d++) backupDbIfNeeded(db, file, new Date(2026, 10, d));
  const names = fs.readdirSync(path.join(dir, 'backups')).sort();
  expect(names).toHaveLength(7);
  expect(names[0]).toBe('gournal-2026-11-03.db');
});
test('backup is a readable database with the same entry count', () => {
  const dest = backupDbIfNeeded(db, file, new Date(2026, 10, 15))!;
  const copy = openDb(dest);
  expect(copy.prepare('SELECT count(*) c FROM entries').get()).toEqual({ c: 1 });
  copy.close();
});
test('backup copy returns correct FTS results (rowids survive)', () => {
  const dest = backupDbIfNeeded(db, file, new Date(2026, 10, 15))!;
  const copy = openDb(dest);
  const hits = copy.prepare('SELECT e.id FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ?').all('zebra');
  expect(hits).toEqual([{ id: 'E1' }]);
  copy.close();
});
