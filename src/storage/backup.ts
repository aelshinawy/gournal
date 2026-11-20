import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { ensurePrivateDir, writeViaTemp } from './private-files';

export const BACKUP_PATTERN = /^gournal-\d{4}-\d{2}-\d{2}\.db$/;
const BACKUP_KEEP = 7;

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Write a forced copy to backups/gournal-pre-plan-yyyyMMdd-HHmmss.db. The daily prune
 * pattern does not match this name, so a snapshot is never pruned. Returns the path.
 */
export function snapshotDb(db: DatabaseSync, dbPath: string, now: Date = new Date()): string {
  const dir = path.join(path.dirname(dbPath), 'backups');
  ensurePrivateDir(dir);
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let dest = path.join(dir, `gournal-pre-plan-${stamp}.db`);
  // Two runs in one second keep both files.
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `gournal-pre-plan-${stamp}-${n}.db`);
  writeViaTemp(dest, (tmp) => { db.prepare('VACUUM INTO ?').run(tmp); });
  return dest;
}

/**
 * Copy the database to backups/gournal-YYYY-MM-DD.db once per local day.
 * It must run outside a transaction (VACUUM INTO cannot run inside one).
 */
export function backupDbIfNeeded(db: DatabaseSync, dbPath: string, now: Date = new Date()): string | null {
  const dir = path.join(path.dirname(dbPath), 'backups');
  const dest = path.join(dir, `gournal-${localDay(now)}.db`);
  if (fs.existsSync(dest)) return null;
  ensurePrivateDir(dir);
  // Copy to a temp name, then rename, so a crash never leaves a partial backup.
  writeViaTemp(dest, (tmp) => { db.prepare('VACUUM INTO ?').run(tmp); });
  const names = fs.readdirSync(dir).filter((n) => BACKUP_PATTERN.test(n)).sort();
  for (const old of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
  // Remove temp files that a crashed process left behind.
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.tmp'))) {
    const f = path.join(dir, n);
    try { if (fs.statSync(f).mtimeMs < cutoff) fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
  return dest;
}
