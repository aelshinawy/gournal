import fs from 'fs';
import path from 'path';

/** One item of the legacy entries.json array, as the v0.5 and v0.6 releases wrote it. */
export interface LegacyEntry {
  timestamp: string;
  message: string;
  project: string;
  tags: string[];
}

export const BACKUP_PATTERN = /^entries-\d{4}-\d{2}-\d{2}\.json$/;

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

export function backupsDir(filePath: string): string {
  return path.join(path.dirname(filePath), 'backups');
}

export function listBackupsSync(filePath: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(backupsDir(filePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return names.filter((n) => BACKUP_PATTERN.test(n)).sort();
}

export async function listBackups(filePath: string): Promise<string[]> {
  return listBackupsSync(filePath);
}

export function latestBackupSync(filePath: string): string | null {
  const names = listBackupsSync(filePath);
  return names.length ? path.join(backupsDir(filePath), names[names.length - 1]) : null;
}

export async function latestBackup(filePath: string): Promise<string | null> {
  return latestBackupSync(filePath);
}

/**
 * Read entries.json. A missing file reads as empty. A file that is not a JSON array throws
 * CorruptJournalError. The file is never written. Items are returned as parsed, not validated.
 */
export function readLegacyEntriesSync(filePath: string): LegacyEntry[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CorruptJournalError(filePath, latestBackupSync(filePath));
  }
  if (!Array.isArray(parsed)) throw new CorruptJournalError(filePath, latestBackupSync(filePath));
  return parsed as LegacyEntry[];
}

export async function readLegacyEntries(filePath: string): Promise<LegacyEntry[]> {
  return readLegacyEntriesSync(filePath);
}
