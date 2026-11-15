import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { format } from 'date-fns';
import type { Entry } from './types';

const DATA_DIR = path.join(process.env.HOME || process.env.USERPROFILE!, '.gournal');
export const ENTRIES_PATH = path.join(DATA_DIR, 'entries.json');

const BACKUP_PATTERN = /^entries-\d{4}-\d{2}-\d{2}\.json$/;
const BACKUP_KEEP = 7;

export class CorruptJournalError extends Error {
  readonly path: string;
  readonly latestBackup: string | null;

  constructor(filePath: string, latestBackup: string | null) {
    super(
      `Journal file ${filePath} is not valid. Latest backup: ${latestBackup ?? 'none'}. Gournal did not change the file.`
    );
    this.name = 'CorruptJournalError';
    this.path = filePath;
    this.latestBackup = latestBackup;
  }
}

function backupsDir(filePath: string): string {
  return path.join(path.dirname(filePath), 'backups');
}

async function listBackups(filePath: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(backupsDir(filePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return names.filter(n => BACKUP_PATTERN.test(n)).sort();
}

export async function latestBackup(filePath = ENTRIES_PATH): Promise<string | null> {
  const names = await listBackups(filePath);
  return names.length ? path.join(backupsDir(filePath), names[names.length - 1]) : null;
}

export async function readEntries(filePath = ENTRIES_PATH): Promise<Entry[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CorruptJournalError(filePath, await latestBackup(filePath));
  }
  if (!Array.isArray(parsed)) {
    throw new CorruptJournalError(filePath, await latestBackup(filePath));
  }
  return parsed as Entry[];
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
  await fs.copyFile(filePath, dest);
  const names = await listBackups(filePath);
  for (const old of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    await fs.remove(path.join(backupsDir(filePath), old));
  }
  return dest;
}

export async function writeEntries(entries: Entry[], filePath = ENTRIES_PATH): Promise<void> {
  await writeEntriesAtomic(entries, filePath);
}
