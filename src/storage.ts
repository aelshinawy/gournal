import fs from 'fs-extra';
import path from 'path';
import type { Entry } from './types.js';

const DATA_DIR = path.join(process.env.HOME || process.env.USERPROFILE!, '.gournal');
const ENTRIES_PATH = path.join(DATA_DIR, 'entries.json');

export async function readEntries(): Promise<Entry[]> {
  await fs.ensureDir(DATA_DIR);
  return fs.readJSON(ENTRIES_PATH).catch(() => []);
}

export async function writeEntries(entries: Entry[]): Promise<void> {
  await fs.writeJSON(ENTRIES_PATH, entries, { spaces: 2 });
}