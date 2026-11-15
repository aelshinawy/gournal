import os from 'os';

// Runs before any test module loads. test/global-setup.ts must already have set the env for the run.
if (!process.env.GOURNAL_TEST_HOME_ROOT) {
  throw new Error('test isolation not initialised: globalSetup did not run');
}
if (!process.env.GOURNAL_REAL_HOME) process.env.GOURNAL_REAL_HOME = os.homedir();
