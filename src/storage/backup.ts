import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { DatabaseSync } from 'node:sqlite';

const BACKUP_PATTERN = /^gournal-\d{4}-\d{2}-\d{2}\.db$/;
const BACKUP_KEEP = 7;

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Copy the database to backups/gournal-YYYY-MM-DD.db once per local day.
 * It must run outside a transaction (VACUUM INTO cannot run inside one).
 * It skips an empty journal, so an empty copy never blocks the real backup of the day.
 */
export function backupDbIfNeeded(db: DatabaseSync, dbPath: string, now: Date = new Date()): string | null {
  const dir = path.join(path.dirname(dbPath), 'backups');
  const dest = path.join(dir, `gournal-${localDay(now)}.db`);
  if (fs.existsSync(dest)) return null;
  if (!db.prepare('SELECT 1 AS x FROM entries LIMIT 1').get()) return null;
  fs.mkdirSync(dir, { recursive: true });
  // Copy to a temp name, then rename, so a crash never leaves a partial backup.
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  const names = fs.readdirSync(dir).filter((n) => BACKUP_PATTERN.test(n)).sort();
  for (const old of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
  return dest;
}
