import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { NODE_FLOOR, enforceNodeFloor, nodeProblem } from '../../src/adapters/node-guard';
import { makeTmp, rmTmp } from '../helpers/tmp';

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let home: string;
beforeEach(() => { home = makeTmp('gournal-guard-'); });
afterEach(() => rmTmp(home));

const spawnOld = (args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, ['-r', path.join(root, 'test/fixtures/old-node.js'), '-r', 'ts-node/register/transpile-only', 'src/cli.ts', ...args],
    { cwd: root, encoding: 'utf8', input: '{}', env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, GOURNAL_HOME: home, ...env } });

test('the floor matches package.json engines and the CI matrix', () => {
  expect(pkg.engines.node).toBe(`>=${NODE_FLOOR.major}.${NODE_FLOOR.minor}`);
  expect(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')).toContain(`'${NODE_FLOOR.major}.${NODE_FLOOR.minor}'`);
});
test('nodeProblem: 22.12.0 is too old, 22.13.0 and 23.0.0 pass, sqlite is checked only for a good version', () => {
  const never = jest.fn(() => true);
  expect(nodeProblem('22.12.0', '/n', never)).toBe('gournal needs Node.js 22.13 or newer. This is Node.js 22.12.0 at /n. Switch to Node.js 22.13 or newer and run the command again.');
  expect(never).not.toHaveBeenCalled();
  expect(nodeProblem('22.13.0', '/n', () => true)).toBeNull();
  expect(nodeProblem('23.0.0', '/n', () => true)).toBeNull();
  expect(nodeProblem('18.20.4', '/n', () => true)).toContain('This is Node.js 18.20.4');
  expect(nodeProblem('24.1.0', '/n', () => false)).toBe('gournal needs the node:sqlite module. The Node.js 24.1.0 build at /n does not have it. Install an official Node.js build.');
});
test('enforceNodeFloor: hook exits 0 with no output, other commands exit 1 with the message', () => {
  const make = (argv: string[]) => { const write = jest.fn(); const exit = jest.fn(); enforceNodeFloor({ argv, version: '22.12.0', execPath: '/n', hasSqlite: () => true, write, exit }); return { write, exit }; };
  const hook = make(['node', 'gournal', 'hook', 'stop']);
  expect(hook.write).not.toHaveBeenCalled();
  expect(hook.exit.mock.calls).toEqual([[0]]);
  const mcp = make(['node', 'gournal', 'mcp']);
  expect(mcp.write.mock.calls).toEqual([[`${nodeProblem('22.12.0', '/n', () => true)}\n`]]);
  expect(mcp.exit.mock.calls).toEqual([[1]]);
  const ok = jest.fn(); const okWrite = jest.fn();
  enforceNodeFloor({ argv: ['node', 'gournal', 'mcp'], version: '22.13.0', execPath: '/n', hasSqlite: () => true, write: okWrite, exit: ok });
  expect([ok.mock.calls, okWrite.mock.calls]).toEqual([[], []]);
});
test('the guard files use only syntax that Node 14 parses', () => {
  for (const f of ['src/cli.ts', 'src/adapters/suppress-warnings.ts', 'src/adapters/node-guard.ts', 'src/adapters/check-node.ts']) {
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
