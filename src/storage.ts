import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { format } from 'date-fns';
import type { Entry } from './types';
import { withLock, type LockOptions } from './lock';
import {
  CorruptJournalError,
  backupsDir,
  latestBackup as latestBackupFromLegacy,
  listBackups,
  readLegacyEntries,
} from './storage/legacy-json';

const DATA_DIR = path.join(process.env.HOME || process.env.USERPROFILE!, '.gournal');
export const ENTRIES_PATH = path.join(DATA_DIR, 'entries.json');

const BACKUP_KEEP = 7;

export { CorruptJournalError };

export function latestBackup(filePath = ENTRIES_PATH): Promise<string | null> {
  return latestBackupFromLegacy(filePath);
}

export function readEntries(filePath = ENTRIES_PATH): Promise<Entry[]> {
  return readLegacyEntries(filePath);
}

export async function writeEntriesAtomic(entries: Entry[], filePath: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.promises.open(tmp, 'w');
    try {
      await handle.writeFile(JSON.stringify(entries, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.remove(tmp).catch(() => undefined);
    throw err;
  }
}

export async function backupIfNeeded(filePath: string, now: Date = new Date()): Promise<string | null> {
  if (!(await fs.pathExists(filePath))) return null;
  const dest = path.join(backupsDir(filePath), `entries-${format(now, 'yyyy-MM-dd')}.json`);
  if (await fs.pathExists(dest)) return null;
  await fs.ensureDir(backupsDir(filePath));
  // Copy to a tmp name, then rename, so a crash never leaves a truncated backup.
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.copyFile(filePath, tmp);
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.remove(tmp).catch(() => undefined);
    throw err;
  }
  const names = await listBackups(filePath);
  for (const old of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    await fs.remove(path.join(backupsDir(filePath), old));
  }
  return dest;
}

export async function updateEntries(
  mutate: (entries: Entry[]) => Entry[],
  filePath = ENTRIES_PATH,
  opts?: LockOptions
): Promise<Entry[]> {
  await fs.ensureDir(path.dirname(filePath));
  return withLock(
    `${filePath}.lock`,
    async () => {
      // Read first: a corrupt file throws here, before any backup copies it.
      const current = await readEntries(filePath);
      await backupIfNeeded(filePath);
      const next = mutate(current);
      await writeEntriesAtomic(next, filePath);
      return next;
    },
    opts
  );
}
