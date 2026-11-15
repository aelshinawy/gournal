import fs from 'fs';
import os from 'os';
import path from 'path';

// Runs before any test module loads. global-setup.ts already set the env for the whole run.
// This file is the fallback if a worker starts without it, and it never lets HOME stay real.
if (!process.env.GOURNAL_REAL_HOME) process.env.GOURNAL_REAL_HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
if (!process.env.GOURNAL_TEST_HOME_ROOT) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-test-home-')));
  process.env.GOURNAL_HOME = temp;
  process.env.HOME = temp;
  process.env.USERPROFILE = temp;
}
