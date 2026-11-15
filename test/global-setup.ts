import fs from 'fs';
import os from 'os';
import path from 'path';

// Runs once in the parent process, before any worker forks. Workers and spawned children inherit
// this env, so os.homedir() (native, reads the real HOME) and child processes stay isolated too.
export default function globalSetup(): void {
  const realHome = process.env.GOURNAL_REAL_HOME || process.env.HOME || process.env.USERPROFILE || os.homedir();
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-test-home-')));
  process.env.GOURNAL_REAL_HOME = realHome;
  process.env.GOURNAL_HOME = temp;
  process.env.HOME = temp;
  process.env.USERPROFILE = temp;
  process.env.GOURNAL_TEST_HOME_ROOT = temp;
}
