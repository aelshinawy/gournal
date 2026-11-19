import os from 'os';
import { makeRealTmp } from './helpers/tmp';

// Runs once in the parent process, before any worker forks. Workers and spawned children inherit
// this env, so os.homedir() (native, reads the real HOME) and child processes stay isolated too.
export default function globalSetup(): void {
  // On Windows the profile is USERPROFILE. HOME can come from Git Bash, and gournal ignores it there.
  const profile = process.platform === 'win32'
    ? process.env.USERPROFILE || process.env.HOME
    : process.env.HOME || process.env.USERPROFILE;
  const realHome = process.env.GOURNAL_REAL_HOME || profile || os.homedir();
  const temp = makeRealTmp('gournal-test-home-');
  process.env.GOURNAL_REAL_HOME = realHome;
  process.env.GOURNAL_HOME = temp;
  process.env.HOME = temp;
  process.env.USERPROFILE = temp;
  process.env.GOURNAL_TEST_HOME_ROOT = temp;
  // Tests never start a background GitHub sync. A test that needs one unsets this for itself.
  process.env.GOURNAL_NO_AUTOSYNC = '1';
}
