import os from 'os';
import path from 'path';

export function gournalHome(): string {
  const home = process.env.GOURNAL_HOME || path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.gournal');
  // Test guard: test/setup-env.ts records the real home. No test may open its .gournal.
  if (process.env.JEST_WORKER_ID && process.env.GOURNAL_REAL_HOME) {
    if (path.resolve(home) === path.resolve(process.env.GOURNAL_REAL_HOME, '.gournal')) {
      throw new Error('refusing to use the real gournal home under test');
    }
  }
  return home;
}
