import os from 'os';
import path from 'path';

export function gournalHome(): string {
  if (process.env.GOURNAL_HOME) return process.env.GOURNAL_HOME;
  const base = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(base, '.gournal');
}
