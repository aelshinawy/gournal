import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_PATTERN } from './backup';
import { migrateSchema } from './schema';

export { migrateSchema, SCHEMA_VERSION } from './schema';

export class CorruptDatabaseError extends Error {
  readonly path: string;
  readonly latestBackup: string | null;
  constructor(dbPath: string, latestBackup: string | null) {
    super(`Database ${dbPath} is not valid. Latest backup: ${latestBackup ?? 'none'}. Gournal did not change the file.`);
    this.name = 'CorruptDatabaseError';
    this.path = dbPath;
    this.latestBackup = latestBackup;
  }
}

function latestBackup(dbPath: string): string | null {
  const dir = path.join(path.dirname(dbPath), 'backups');
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => BACKUP_PATTERN.test(f) && fs.statSync(path.join(dir, f)).isFile())
      .sort();
    return files.length ? path.join(dir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function isCorruption(err: unknown): boolean {
  const e = err as { code?: string; errcode?: number; errstr?: string; message?: string };
  const text = `${e?.code ?? ''} ${e?.errstr ?? ''} ${e?.message ?? ''}`;
  // 26 = SQLITE_NOTADB, 11 = SQLITE_CORRUPT
  return e?.errcode === 26 || e?.errcode === 11 || /SQLITE_NOTADB|SQLITE_CORRUPT|not a database|malformed/i.test(text);
}

export function openDb(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    // The first statement reads the file header. It fails on a non-database file.
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('PRAGMA journal_mode = WAL').get();
    db.exec('PRAGMA foreign_keys = ON');
    migrateSchema(db);
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    if (isCorruption(err)) throw new CorruptDatabaseError(dbPath, latestBackup(dbPath));
    throw err;
  }
  return db;
}
