import fs from 'fs-extra';
import path from 'path';
import type { Entry } from './types';

const DATA_DIR = path.join(process.env.HOME || process.env.USERPROFILE!, '.gournal');
const ENTRIES_PATH = path.join(DATA_DIR, 'entries.json');

export async function readEntries(path = ENTRIES_PATH): Promise<Entry[]> {
  await fs.ensureDir(DATA_DIR);
  return fs.readJSON(path).catch(() => []);
}

export async function writeEntries(entries: Entry[], path = ENTRIES_PATH): Promise<void> {
  await fs.writeJSON(path, entries, { spaces: 2 });
}