import fs from 'fs';
import path from 'path';
import { detectHomebrew } from '../../src/adapters/setup/homebrew';
import { makeFakeBrew } from '../helpers/fake-brew';
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

posixTest('a Homebrew setup registers the launcher and records the opt node', async () => {
  const { prefix, packageRoot } = makeFakeBrew(root, VERSION);
  expect(await h.run({ hook: true }, h.makeIo({ packageRoot }))).toBe(0);
  expect(h.calls).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', LAUNCHER(), 'mcp']]);
  expect(recordedNode()).toBe(`${prefix}/opt/node/bin/node\n`);
  expect(fs.readFileSync(LAUNCHER(), 'utf8')).not.toContain('Cellar');
});
