import fs from 'fs';
import path from 'path';
import { createLauncherCheck, minimalEnv } from '../../src/adapters/setup/launcher-check';
import { makeRealTmp, rmTmp } from '../helpers/tmp';

const posixTest = process.platform === 'win32' ? test.skip : test;

let dir: string;
beforeEach(() => { dir = makeRealTmp('gournal-check-'); });
afterEach(() => rmTmp(dir));

posixTest('createLauncherCheck runs with HOME and /usr/bin:/bin only', async () => {
  const script = path.join(dir, 'probe');
  fs.writeFileSync(script, '#!/bin/sh\nprintf \'%s|%s|%s|%s\\n\' "$PATH" "$HOME" "${GOURNAL_HOME-unset}" "${NVM_DIR-unset}"\n', { mode: 0o755 });
  const userHome = path.join(dir, 'user');
  const saved = { g: process.env.GOURNAL_HOME, n: process.env.NVM_DIR };
  process.env.GOURNAL_HOME = '/leak';
  process.env.NVM_DIR = '/leak';
  try {
    const r = await createLauncherCheck('linux', userHome)(script, []);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(`/usr/bin:/bin|${userHome}|unset|unset`);
  } finally {
    for (const [key, value] of [['GOURNAL_HOME', saved.g], ['NVM_DIR', saved.n]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
