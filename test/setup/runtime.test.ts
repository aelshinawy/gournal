import fs from 'fs';
import path from 'path';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { makeFakePackage } from '../helpers/fake-package';
import { copyPackage, packageFingerprint } from '../../src/adapters/setup/package-copy';
import { installRuntime, refreshRuntime, removeRuntime, runtimePaths, shouldRefresh } from '../../src/adapters/setup/runtime';
import { renderPosixLauncher } from '../../src/adapters/setup/launcher';
import { runCli } from '../../src/adapters/cli/program';

const dirs: string[] = [];
afterAll(() => dirs.forEach(rmTmp));
const tmp = (): string => {
  const d = makeRealTmp('gournal-runtime-');
  dirs.push(d);
  return d;
};
const posixTest = process.platform === 'win32' ? test.skip : test;
const apps = (home: string): string[] => fs.readdirSync(path.join(home, 'runtime')).filter((n) => n.startsWith('app-')).sort();
const install = (home: string, pkg: string, platform: NodeJS.Platform = process.platform) =>
  installRuntime({ gournalHome: home, packageRoot: pkg, nodePath: '/n/node', platform, bakeHome: false });

test('copyPackage copies package.json, dist, and the production closure only', () => {
  const root = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'node_modules', 'devonly'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'devonly', 'package.json'), '{"name":"devonly","version":"1.0.0"}');
  const dest = path.join(tmp(), 'out');
  copyPackage(root, dest);
  expect(fs.readdirSync(dest).sort()).toEqual(['dist', 'node_modules', 'package.json']);
  expect(fs.readdirSync(path.join(dest, 'node_modules'))).toEqual(['dep']);
  expect(fs.existsSync(path.join(dest, 'dist', 'cli.js'))).toBe(true);
});

test('a dependency with another version than the hoisted one is nested', () => {
  const root = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0', { a: '1.0.0', b: '1.0.0' });
  fs.writeFileSync(path.join(root, 'node_modules', 'a', 'package.json'), JSON.stringify({ name: 'a', version: '1.0.0', dependencies: { shared: '1.0.0' } }));
  fs.writeFileSync(path.join(root, 'node_modules', 'b', 'package.json'), JSON.stringify({ name: 'b', version: '1.0.0', dependencies: { shared: '2.0.0' } }));
  fs.mkdirSync(path.join(root, 'node_modules', 'shared'));
  fs.writeFileSync(path.join(root, 'node_modules', 'shared', 'package.json'), '{"name":"shared","version":"1.0.0"}');
  fs.mkdirSync(path.join(root, 'node_modules', 'b', 'node_modules', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'b', 'node_modules', 'shared', 'package.json'), '{"name":"shared","version":"2.0.0"}');
  const dest = path.join(tmp(), 'out');
  copyPackage(root, dest);
  const version = (p: string): string => (JSON.parse(fs.readFileSync(path.join(dest, p, 'package.json'), 'utf8')) as { version: string }).version;
  expect(version('node_modules/shared')).toBe('1.0.0');
  expect(version('node_modules/b/node_modules/shared')).toBe('2.0.0');
});

test('a missing required dependency throws the exact message', () => {
  const root = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
  expect(() => copyPackage(root, path.join(tmp(), 'out'))).toThrow(
    `cannot copy gournal: dependency dep not found from ${fs.realpathSync(root)}`,
  );
});

test('copyPackage names the missing build', () => {
  const root = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  fs.rmSync(path.join(root, 'dist'), { recursive: true });
  expect(() => copyPackage(root, path.join(tmp(), 'out'))).toThrow(`cannot copy gournal from ${root}: no dist/cli.js. Run npm run build.`);
});

test('the fingerprint changes when dist changes and is stable otherwise', () => {
  const root = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  const first = packageFingerprint(root);
  expect(first).toMatch(/^[0-9a-f]{12}$/);
  expect(packageFingerprint(root)).toBe(first);
  fs.writeFileSync(path.join(root, 'dist', 'cli.js'), 'changed');
  expect(packageFingerprint(root)).not.toBe(first);
});

test('installRuntime: installed, then unchanged, then updated after a dist change', () => {
  const home = path.join(tmp(), 'h');
  const pkg = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  expect(install(home, pkg).action).toBe('installed');
  expect(install(home, pkg).action).toBe('unchanged');
  fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), 'changed');
  expect(install(home, pkg).action).toBe('updated');
});

test('installRuntime writes current, node, and a 0700 launcher with the rendered content', () => {
  const home = path.join(tmp(), 'h');
  const pkg = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  const { paths } = install(home, pkg);
  const [app] = apps(home);
  expect(fs.readFileSync(paths.currentFile, 'utf8')).toBe(`${app}\n`);
  expect(fs.readFileSync(paths.nodeFile, 'utf8')).toBe('/n/node\n');
  expect(fs.existsSync(path.join(home, 'runtime', app, '.complete'))).toBe(true);
  if (process.platform !== 'win32') {
    expect(fs.readFileSync(paths.launcher, 'utf8')).toBe(renderPosixLauncher({ home, bakeHome: false }));
    expect(fs.statSync(paths.launcher).mode & 0o777).toBe(0o700);
  }
});

test('a switch keeps the previous app and prunes older ones', () => {
  const home = path.join(tmp(), 'h');
  const pkg = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  install(home, pkg);
  const first = apps(home)[0];
  for (const v of ['2', '3']) {
    fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), `v${v}`);
    install(home, pkg);
  }
  const current = fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8').trim();
  const left = apps(home);
  expect(left).toHaveLength(2);
  expect(left).toContain(current);
  expect(left).not.toContain(first);
  // the previous app is the one before the last switch, and it stays whole
  const previous = left.find((n) => n !== current) as string;
  expect(fs.existsSync(path.join(home, 'runtime', previous, 'dist', 'cli.js'))).toBe(true);
});

test('an app folder without .complete is never reused and temp folders are pruned', () => {
  const home = path.join(tmp(), 'h');
  const pkg = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  const { paths } = install(home, pkg);
  const [app] = apps(home);
  fs.rmSync(path.join(paths.runtimeDir, app, '.complete'));
  fs.rmSync(path.join(paths.runtimeDir, app, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(paths.runtimeDir, '.tmp-999-abc'));
  fs.writeFileSync(path.join(paths.runtimeDir, '.tmp-999-abc', 'x'), 'x');
  install(home, pkg);
  expect(fs.existsSync(path.join(paths.runtimeDir, app, '.complete'))).toBe(true);
  expect(fs.existsSync(path.join(paths.runtimeDir, app, 'dist', 'cli.js'))).toBe(true);
  expect(fs.readdirSync(paths.runtimeDir).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
});

test('removeRuntime removes the launcher and the runtime and keeps gournal.db', () => {
  const home = path.join(tmp(), 'h');
  const pkg = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  install(home, pkg);
  fs.writeFileSync(path.join(home, 'gournal.db'), 'db');
  expect(removeRuntime(home, process.platform)).toBe(true);
  expect(fs.existsSync(path.join(home, 'runtime'))).toBe(false);
  expect(fs.existsSync(path.join(home, 'bin'))).toBe(false);
  expect(fs.readFileSync(path.join(home, 'gournal.db'), 'utf8')).toBe('db');
  expect(removeRuntime(home, process.platform)).toBe(false);
});

test('refreshRuntime does nothing without a runtime and creates no files', () => {
  const home = path.join(tmp(), 'h');
  const pkg = makeFakePackage(path.join(tmp(), 'pkg'), '1.0.0');
  expect(refreshRuntime(home, { packageRoot: pkg })).toBe(false);
  expect(fs.existsSync(home)).toBe(false);
});

const installed = (name: string, version: string): string =>
  makeFakePackage(path.join(tmp(), 'node_modules', name === 'gournal' ? 'gournal' : name), version);

const setVersion = (pkg: string, version: string): void =>
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'gournal', version, dependencies: { dep: '1.0.0' } }));

test('refreshRuntime switches only to a newer version of the recorded package', () => {
  const home = path.join(tmp(), 'h');
  const pkg = installed('gournal', '0.9.0');
  install(home, pkg);
  expect(refreshRuntime(home, { packageRoot: pkg })).toBe(false);
  setVersion(pkg, '0.10.0');
  expect(refreshRuntime(home, { packageRoot: pkg })).toBe(true);
  const current = fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8');
  expect(current).toMatch(/^app-0\.10\.0-/);
  expect(fs.readFileSync(runtimePaths(home, process.platform).nodeFile, 'utf8')).toBe('/n/node\n');
  setVersion(pkg, '0.9.0');
  expect(refreshRuntime(home, { packageRoot: pkg })).toBe(false);
  setVersion(pkg, '0.10.0');
  expect(refreshRuntime(home, { packageRoot: pkg })).toBe(false);
});

test('refreshRuntime skips a newer install that is not the recorded source', () => {
  const home = path.join(tmp(), 'h');
  const recorded = installed('gournal', '0.9.0');
  install(home, recorded);
  const before = fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8');
  const records = ['source', 'anchor', 'rack'].map((n) => fs.readFileSync(path.join(home, 'runtime', n), 'utf8'));
  expect(refreshRuntime(home, { packageRoot: installed('gournal', '0.10.0') })).toBe(false);
  expect(fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8')).toBe(before);
  expect(['source', 'anchor', 'rack'].map((n) => fs.readFileSync(path.join(home, 'runtime', n), 'utf8'))).toEqual(records);
});

test('installRuntime without records writes npm records from the package root', () => {
  const home = path.join(tmp(), 'h');
  const pkg = installed('gournal', '1.0.0');
  install(home, pkg);
  const read = (n: string): string => fs.readFileSync(path.join(home, 'runtime', n), 'utf8');
  expect(read('source')).toBe(`${fs.realpathSync(pkg)}\n`);
  expect(read('anchor')).toBe(`${path.dirname(fs.realpathSync(pkg))}\n`);
  expect(read('rack')).toBe(`${fs.realpathSync(pkg)}\n`);
});

posixTest('installRuntime for a Homebrew package writes the opt source, Cellar anchor, and Cellar/gournal rack', () => {
  const prefix = path.join(tmp(), 'brew');
  const cellar = path.join(prefix, 'Cellar', 'gournal', '1.0.0', 'libexec', 'lib', 'node_modules', 'gournal');
  makeFakePackage(cellar, '1.0.0');
  fs.mkdirSync(path.join(prefix, 'opt', 'node', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(prefix, 'opt', 'node', 'bin', 'node'), '');
  fs.symlinkSync(path.join(prefix, 'Cellar', 'gournal', '1.0.0'), path.join(prefix, 'opt', 'gournal'));
  const home = path.join(tmp(), 'h');
  install(home, cellar);
  const read = (n: string): string => fs.readFileSync(path.join(home, 'runtime', n), 'utf8');
  expect(read('source')).toBe(`${prefix}/opt/gournal/libexec/lib/node_modules/gournal\n`);
  expect(read('anchor')).toBe(`${prefix}/Cellar\n`);
  expect(read('rack')).toBe(`${prefix}/Cellar/gournal\n`);
});

test('refreshRuntime ignores a newer checkout outside node_modules', () => {
  const home = path.join(tmp(), 'h');
  install(home, installed('gournal', '0.9.0'));
  const before = fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8');
  const checkout = makeFakePackage(path.join(tmp(), 'checkout'), '0.10.0');
  expect(refreshRuntime(home, { packageRoot: checkout })).toBe(false);
  expect(fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8')).toBe(before);
});

posixTest('refreshRuntime ignores a node_modules symlink that points at a checkout', () => {
  const home = path.join(tmp(), 'h');
  install(home, installed('gournal', '0.9.0'));
  const before = fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8');
  const checkout = makeFakePackage(path.join(tmp(), 'checkout'), '0.10.0');
  const link = path.join(tmp(), 'node_modules', 'gournal');
  fs.mkdirSync(path.dirname(link));
  fs.symlinkSync(checkout, link);
  expect(refreshRuntime(home, { packageRoot: link })).toBe(false);
  expect(fs.readFileSync(runtimePaths(home, process.platform).currentFile, 'utf8')).toBe(before);
});

test('shouldRefresh skips mcp and hook', () => {
  expect(shouldRefresh(['node', 'gournal', 'mcp'])).toBe(false);
  expect(shouldRefresh(['node', 'gournal', 'hook', 'stop'])).toBe(false);
  expect(shouldRefresh(['node', 'gournal', 'add', 'x'])).toBe(true);
});

test('runCli calls the refresh seam with the gournal home', async () => {
  const home = tmp();
  const seen: string[] = [];
  await runCli(['node', 'gournal', '--version'], { home, out: () => {}, err: () => {}, runtimeRefresh: (h) => { seen.push(h); } });
  expect(seen).toEqual([home]);
});

test('a throwing refresh never fails the command', async () => {
  const home = tmp();
  const out: string[] = [];
  const code = await runCli(['node', 'gournal', '--version'], { home, out: (t) => out.push(t), err: () => {}, runtimeRefresh: () => { throw new Error('boom'); } });
  expect(code).toBe(0);
  expect(out.join('')).toMatch(/\d+\.\d+\.\d+/);
});

posixTest('the real default refresh does nothing in a home without a runtime', async () => {
  const home = tmp();
  await runCli(['node', 'gournal', '--version'], { home, out: () => {}, err: () => {} });
  expect(fs.readdirSync(home)).toEqual([]);
});
