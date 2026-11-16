import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_PATTERN } from './backup';
import { ensureSearchIndex, migrateSchema } from './schema';
import { ensurePrivateDir, ensurePrivateFile, sleepSync, tightenBackups, tightenDbFiles } from './private-files';

export { ensureSearchIndex, migrateSchema, SCHEMA_VERSION } from './schema';

export class CorruptDatabaseError extends Error {
  readonly path: string;
  readonly latestBackup: string | null;
  constructor(dbPath: string, latestBackup: string | null) {
    super(`Database ${dbPath} is not valid. Latest backup: ${latestBackup ?? 'none'}. Gournal did not change the file. To restore, stop all gournal processes, move gournal.db, gournal.db-wal and gournal.db-shm aside, then copy the backup to gournal.db.`);
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

function isReadOnly(err: unknown): boolean {
  const e = err as { errcode?: number; message?: string };
  // The low byte of an extended code is the primary code. 8 = SQLITE_READONLY (1544 = READONLY_DIRECTORY).
  return (typeof e?.errcode === 'number' && (e.errcode & 0xff) === 8) || /readonly database/i.test(e?.message ?? '');
}

const BUSY_TIMEOUT_MS = 5000;
/** Total time to keep retrying a busy start-up, counted from the first busy error. */
const INIT_RETRY_BUDGET_MS = 5000;
const INIT_RETRY_MAX_DELAY_MS = 100;

/** The low byte of an extended code is the primary code. 5 = SQLITE_BUSY. Code 6 (SQLITE_LOCKED) is not retried. */
function isBusy(err: unknown): boolean {
  const e = err as { errcode?: number };
  return typeof e?.errcode === 'number' && (e.errcode & 0xff) === 5;
}

export interface OpenDbDeps {
  /** Test seam. The default blocks the thread. */
  sleep?: (ms: number) => void;
  /** Test seam. The default is Date.now. */
  now?: () => number;
  /** Test seam. The default is 5000. */
  busyTimeoutMs?: number;
}

/**
 * Open the database and bring it to the current schema.
 *
 * Several processes can open a new file at the same time (for example a hook and the MCP server).
 * Then the switch to WAL can fail at once with SQLITE_BUSY. SQLite skips the busy handler in that
 * case to avoid a deadlock, so busy_timeout does not help. Every start-up step is safe to repeat,
 * so this function repeats them after a short wait. It retries only SQLITE_BUSY, for at most 5 s.
 */
export function openDb(dbPath: string, deps: OpenDbDeps = {}): DatabaseSync {
  const sleep = deps.sleep ?? sleepSync;
  const now = deps.now ?? Date.now;
  const home = path.dirname(dbPath);
  ensurePrivateDir(home);
  // Create the file as 0600 before SQLite does. SQLite copies its mode to the WAL and SHM files.
  ensurePrivateFile(dbPath);
  tightenDbFiles(dbPath);
  tightenBackups(home);
  const db = new DatabaseSync(dbPath);
  try {
    let firstBusyAt: number | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        // The first statement reads the file header. It fails on a non-database file.
        db.exec(`PRAGMA busy_timeout = ${deps.busyTimeoutMs ?? BUSY_TIMEOUT_MS}`);
        db.prepare('PRAGMA journal_mode = WAL').get();
        db.exec('PRAGMA foreign_keys = ON');
        migrateSchema(db);
        ensureSearchIndex(db);
        break;
      } catch (err) {
        if (!isBusy(err)) throw err;
        firstBusyAt ??= now();
        if (now() - firstBusyAt >= INIT_RETRY_BUDGET_MS) throw err;
        // Backoff 10, 20, 40, 80, 100 ms and so on. The process id spreads the retries of different processes.
        sleep(Math.min(10 * 2 ** attempt, INIT_RETRY_MAX_DELAY_MS) + (process.pid % 10));
      }
    }
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    if (isCorruption(err)) throw new CorruptDatabaseError(dbPath, latestBackup(dbPath));
    if (isReadOnly(err)) throw new Error(`gournal home ${home} is not writable. Fix its permissions or set GOURNAL_HOME.`);
    throw err;
  }
  return db;
}
