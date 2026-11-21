import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { makeTmp, rmTmp } from '../helpers/tmp';

const root = path.join(__dirname, '..', '..');
let home: string;
beforeEach(() => { home = makeTmp('gournal-guard-'); });
afterEach(() => rmTmp(home));

const spawnOld = (args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, ['-r', path.join(root, 'test/fixtures/old-node.js'), '-r', 'ts-node/register/transpile-only', 'src/cli.ts', ...args],
    { cwd: root, encoding: 'utf8', input: '{}', env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, GOURNAL_HOME: home, ...env } });

test('the guard files use only syntax that Node 14 parses', () => {
  for (const f of ['src/cli.ts', 'src/adapters/suppress-warnings.ts', 'src/adapters/check-node.ts']) {
    expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toMatch(/\?\?=|\|\|=|&&=|static\s*\{|#[A-Za-z_]\w*\s*[=(;]|^\s*await\b/m);
  }
});
test('--version on a fake Node 22.12.0 prints the guard message, not ERR_UNKNOWN_BUILTIN_MODULE', () => {
  const r = spawnOld(['--version'], { FAKE_NODE_VERSION: '22.12.0' });
  expect(r.status).toBe(1);
  expect(r.stderr).not.toContain('ERR_UNKNOWN_BUILTIN_MODULE');
  expect(r.stderr.trim()).toBe(`gournal needs Node.js 22.13 or newer. This is Node.js 22.12.0 at ${process.execPath}. Switch to Node.js 22.13 or newer and run the command again.`);
});
test('hook stop on a fake Node 22.12.0 exits 0 with no output', () => {
  const r = spawnOld(['hook', 'stop'], { FAKE_NODE_VERSION: '22.12.0' });
  expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
});
test('a Node build without node:sqlite gets the sqlite message', () => {
  const r = spawnOld(['--version'], {});
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('gournal needs the node:sqlite module.');
});
