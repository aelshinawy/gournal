import fs from 'fs';
import path from 'path';
import { detectHomebrew } from '../../src/adapters/setup/homebrew';
import { makeFakeBrew } from '../helpers/fake-brew';
import { makeFakePackage } from '../helpers/fake-package';
import { makeHarness, type Harness } from '../helpers/setup-harness';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { VERSION } from '../../src/adapters/version';

const posixTest = process.platform === 'win32' ? test.skip : test;

let root: string;
let h: Harness;
beforeEach(() => {
  root = makeRealTmp('gournal-brew-');
  h = makeHarness(root);
});
afterEach(() => rmTmp(root));

const LAUNCHER = () => path.join(h.gh, 'bin', 'gournal');
const recordedNode = () => fs.readFileSync(path.join(h.gh, 'runtime', 'node'), 'utf8');

posixTest('detectHomebrew finds the opt paths from a Cellar package', () => {
  const { prefix, packageRoot } = makeFakeBrew(root, '0.9.0');
  expect(detectHomebrew(packageRoot, 'darwin')).toEqual({
    prefix,
    node: `${prefix}/opt/node/bin/node`,
    source: `${prefix}/opt/gournal/libexec/lib/node_modules/gournal`,
  });
});

posixTest('detectHomebrew is null for an npm global install, on win32, and without opt/node', () => {
  const npmRoot = makeFakePackage(path.join(root, 'npm', 'lib', 'node_modules', 'gournal'), '0.9.0');
  expect(detectHomebrew(npmRoot, 'darwin')).toBeNull();
  expect(detectHomebrew(path.join(root, 'missing'), 'darwin')).toBeNull();
  const { prefix, packageRoot } = makeFakeBrew(root, '0.9.0');
  expect(detectHomebrew(packageRoot, 'win32')).toBeNull();
  fs.rmSync(path.join(prefix, 'opt', 'node'), { recursive: true });
  expect(detectHomebrew(packageRoot, 'darwin')).toBeNull();
});

posixTest('detectHomebrew is null for an npm global package on a Homebrew prefix with opt/node', () => {
  const { prefix } = makeFakeBrew(root, '0.9.0');
  const npmRoot = makeFakePackage(path.join(prefix, 'lib', 'node_modules', 'gournal'), '0.9.0');
  expect(fs.existsSync(path.join(prefix, 'opt', 'node', 'bin', 'node'))).toBe(true);
  expect(detectHomebrew(npmRoot, 'darwin')).toBeNull();
});

posixTest('detectHomebrew is null when the opt package has no dist/cli.js', () => {
  const { prefix, packageRoot } = makeFakeBrew(root, '0.9.0');
  fs.rmSync(path.join(prefix, 'opt', 'gournal', 'libexec', 'lib', 'node_modules', 'gournal', 'dist', 'cli.js'));
  expect(detectHomebrew(packageRoot, 'darwin')).toBeNull();
});

posixTest('a Homebrew setup registers the launcher and records the opt node', async () => {
  const { prefix, packageRoot } = makeFakeBrew(root, VERSION);
  expect(await h.run({ hook: true }, h.makeIo({ packageRoot }))).toBe(0);
  expect(h.calls).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', LAUNCHER(), 'mcp']]);
  expect(recordedNode()).toBe(`${prefix}/opt/node/bin/node\n`);
  expect(fs.readFileSync(LAUNCHER(), 'utf8')).not.toContain('Cellar');
  expect(recordedNode()).not.toContain('Cellar');
  expect(h.out).toContain(`Homebrew: the launcher runs gournal from ${prefix}/opt/gournal with ${prefix}/opt/node/bin/node.`);
  expect(h.stopCommands(h.readSettings())).toHaveLength(1);
});

posixTest('npm to Homebrew to npm keeps one registration and one hook', async () => {
  const { prefix, packageRoot } = makeFakeBrew(root, VERSION);
  const npm = h.makeIo();
  expect(await h.run({ hook: true }, npm)).toBe(0);
  expect(recordedNode()).toBe('/opt/node/bin/node\n');
  expect(await h.run({ hook: true }, h.makeIo({ packageRoot }))).toBe(0);
  expect(recordedNode()).toBe(`${prefix}/opt/node/bin/node\n`);
  expect(await h.run({ hook: true }, h.makeIo())).toBe(0);
  expect(recordedNode()).toBe('/opt/node/bin/node\n');
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]).toContain('add');
  expect(h.stopCommands(h.readSettings())).toHaveLength(1);
});

posixTest('uninstall after a Homebrew setup keeps the Cellar files', async () => {
  const { packageRoot } = makeFakeBrew(root, VERSION);
  expect(await h.run({ hook: true }, h.makeIo({ packageRoot }))).toBe(0);
  expect(await h.run({ uninstall: true }, h.makeIo({ packageRoot }))).toBe(0);
  expect(fs.existsSync(path.join(packageRoot, 'dist', 'cli.js'))).toBe(true);
  expect(fs.existsSync(path.join(h.gh, 'bin', 'gournal'))).toBe(false);
});
