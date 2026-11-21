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

test('minimalEnv on win32 keeps only the listed keys', () => {
  const env = { SystemRoot: 'D:\\Win', APPDATA: 'a', LOCALAPPDATA: 'l', NVM_HOME: 'x', PATH: 'p', GOURNAL_HOME: 'g' };
  expect(minimalEnv('win32', 'u', env)).toEqual({ USERPROFILE: 'u', SystemRoot: 'D:\\Win', APPDATA: 'a', LOCALAPPDATA: 'l', PATH: 'D:\\Win\\System32' });
  expect(Object.keys(minimalEnv('win32', 'u', { SystemRoot: 'D:\\Win' }))).toEqual(['USERPROFILE', 'SystemRoot', 'PATH']);
});

test('minimalEnv on POSIX is HOME and a short PATH', () => {
  expect(minimalEnv('darwin', '/u', { PATH: '/x', NVM_DIR: '/n' })).toEqual({ HOME: '/u', PATH: '/usr/bin:/bin' });
});

test('a missing launcher gives code 127', async () => {
  const r = await createLauncherCheck('linux', dir)(path.join(dir, 'nope'), []);
  expect(r.code).toBe(127);
});

posixTest('a launcher that exits non-zero gives its code and stderr', async () => {
  const script = path.join(dir, 'fail');
  fs.writeFileSync(script, '#!/bin/sh\necho nope >&2\nexit 7\n', { mode: 0o755 });
  const r = await createLauncherCheck('linux', dir)(script, []);
  expect(r.code).toBe(7);
  expect(r.stderr.trim()).toBe('nope');
});
