import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { ftsTest } from '../fts5';
import { backupDbIfNeeded } from '../../src/storage/backup';
import { asPlatform } from '../helpers/platform';
import { makeTmp, rmTmp } from '../helpers/tmp';

let dir: string; let file: string; let db: DatabaseSync;
beforeEach(() => {
  dir = makeTmp('gournal-bak-');
  file = path.join(dir, 'gournal.db');
  db = openDb(file);
  db.prepare('INSERT INTO entries (id, created_at, updated_at, device_id, summary, details) VALUES (?, 1, 1, ?, ?, ?)')
    .run('E1', 'D', 'findable zebra', null);
});
afterEach(() => { db.close(); rmTmp(dir); });

test('removes stale temp files but keeps fresh ones', () => {
  const bdir = path.join(dir, 'backups');
  fs.mkdirSync(bdir);
  const stale = path.join(bdir, 'old.tmp'); const fresh = path.join(bdir, 'new.tmp');
  fs.writeFileSync(stale, 'x'); fs.writeFileSync(fresh, 'x');
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  fs.utimesSync(stale, old, old);
  backupDbIfNeeded(db, file, new Date(2026, 10, 15));
  expect(fs.existsSync(stale)).toBe(false);
  expect(fs.existsSync(fresh)).toBe(true);
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
ftsTest('backup copy returns correct FTS results (rowids survive)', () => {
  const dest = backupDbIfNeeded(db, file, new Date(2026, 10, 15))!;
  const copy = openDb(dest);
  const hits = copy.prepare('SELECT e.id FROM entries_fts f JOIN entries e ON e.rowid = f.rowid WHERE entries_fts MATCH ?').all('zebra');
  expect(hits).toEqual([{ id: 'E1' }]);
  copy.close();
});

test('the daily prune never removes a pre-plan snapshot', () => {
  const bdir = path.join(dir, 'backups');
  fs.mkdirSync(bdir);
  const snap = path.join(bdir, 'gournal-pre-plan-20260101-000000.db');
  fs.writeFileSync(snap, 'x');
  for (let d = 1; d <= 9; d++) fs.writeFileSync(path.join(bdir, `gournal-2026-11-0${d}.db`), 'x');
  backupDbIfNeeded(db, file, new Date(2026, 10, 15));
  expect(fs.existsSync(snap)).toBe(true);
  expect(fs.readdirSync(bdir).filter((n) => /^gournal-\d{4}-/.test(n))).toHaveLength(7);
});

test('the daily backup retries a Windows rename', () => {
  const real = fs.renameSync.bind(fs);
  let n = 0;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
    if (n++ === 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    real(a, b);
  });
  const saved = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  let dest: string | null;
  try { dest = backupDbIfNeeded(db, file, new Date(2026, 10, 15)); } finally { Object.defineProperty(process, 'platform', saved); spy.mockRestore(); }
  expect(n).toBe(2);
  expect(dest).toBe(path.join(dir, 'backups', 'gournal-2026-11-15.db'));
  expect(fs.readdirSync(path.join(dir, 'backups'))).toEqual(['gournal-2026-11-15.db']);
});
test('the daily backup does not retry a rename on linux', () => {
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
  try {
    expect(() => asPlatform('linux', () => backupDbIfNeeded(db, file, new Date(2026, 10, 15)))).toThrow('EPERM');
    expect(spy).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
  expect(fs.readdirSync(path.join(dir, 'backups'))).toEqual([]);
});
