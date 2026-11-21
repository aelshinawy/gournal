import fs from 'fs';
import path from 'path';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { makeFakePackage } from '../helpers/fake-package';
import { copyPackage } from '../../src/adapters/setup/package-copy';
import { adoptInstalledPackage, installRuntime } from '../../src/adapters/setup/runtime';
import { readRecords } from '../../src/adapters/setup/source';

const dirs: string[] = [];
afterAll(() => dirs.forEach(rmTmp));
const tmp = (): string => {
  const d = makeRealTmp('gournal-runtime-');
  dirs.push(d);
  return d;
};
const install = (home: string, pkg: string) => installRuntime({ gournalHome: home, packageRoot: pkg, nodePath: '/n/node', platform: process.platform, bakeHome: false });

test('a second install of the same version reuses the copy, and an unfinished copy is rebuilt', () => {
  const home = path.join(tmp(), 'h');
  const pkg = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  expect(install(home, pkg).action).toBe('installed');
  expect(install(home, pkg).action).toBe('unchanged');
  const runtime = path.join(home, 'runtime');
  const [app] = fs.readdirSync(runtime).filter((n) => n.startsWith('app-'));
  fs.rmSync(path.join(runtime, app!, '.complete'));
  fs.rmSync(path.join(runtime, app!, 'dist'), { recursive: true });
  install(home, pkg);
  expect(fs.existsSync(path.join(runtime, app!, 'dist', 'cli.js'))).toBe(true);
});

test('a run from a global npm install adopts it when the recorded source is gone, and other layouts do not', () => {
  const home = path.join(tmp(), 'h');
  const prefix = tmp();
  const win = process.platform === 'win32';
  const execPath = path.join(prefix, win ? 'node.exe' : path.join('bin', 'node'));
  fs.mkdirSync(path.dirname(execPath), { recursive: true });
  fs.writeFileSync(execPath, '');
  const modules = path.join(prefix, ...(win ? ['node_modules'] : ['lib', 'node_modules']));
  const old = makeFakePackage(path.join(tmp(), 'gone', 'node_modules', 'gournal'), '1.0.0');
  const oldReal = fs.realpathSync(old);
  install(home, old);
  fs.rmSync(old, { recursive: true });
  const source = (): string => readRecords(path.join(home, 'runtime'))!.source;
  const adopt = (packageRoot: string): void => adoptInstalledPackage(home, { packageRoot, execPath });
  for (const other of ['.npm/_npx/abc/node_modules/gournal', 'project/node_modules/gournal', 'checkout']) {
    adopt(makeFakePackage(path.join(tmp(), other), '1.0.0'));
    expect(source()).toBe(oldReal);
  }
  const fresh = makeFakePackage(path.join(modules, 'gournal'), '1.0.0');
  adopt(fresh);
  expect(source()).toBe(fs.realpathSync(fresh));
});

test('copyPackage nests a dependency whose version differs from the hoisted one', () => {
  const root = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0', { a: '1.0.0', b: '1.0.0' });
  const shared = (dir: string, version: string): void => {
    fs.mkdirSync(path.join(root, dir, 'node_modules', 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify({ name: dir, version: '1.0.0', dependencies: { shared: version } }));
    fs.writeFileSync(path.join(root, dir, 'node_modules', 'shared', 'package.json'), JSON.stringify({ name: 'shared', version }));
  };
  shared('node_modules/a', '1.0.0');
  shared('node_modules/b', '2.0.0');
  const dest = path.join(tmp(), 'out');
  copyPackage(root, dest);
  expect(fs.existsSync(path.join(dest, 'node_modules', 'b', 'node_modules', 'shared'))).toBe(true);
});
