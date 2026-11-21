import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { writeFakeNode } from '../helpers/fake-node';
import {
  INSTALL_FAMILIES,
  POSIX_CANDIDATES,
  checkLauncherPath,
  launcherCommand,
  renderPosixLauncher,
  type NodeCandidates,
} from '../../src/adapters/setup/launcher';
import { WINDOWS_CANDIDATES, renderWindowsLauncher } from '../../src/adapters/setup/launcher-windows';
import { shellQuote } from '../../src/adapters/setup/command';

const posixTest = process.platform === 'win32' ? test.skip : test;
const windowsTest = process.platform === 'win32' ? test : test.skip;

const NO_NODE =
  'gournal: found no Node.js 22.13 or newer with the node:sqlite module. Install Node.js 22.13 or newer. Then run "gournal setup claude" in a terminal.\n';

const roots: string[] = [];
afterAll(() => roots.forEach(rmTmp));

interface Fixture { root: string; home: string; launcher: string }

function fixture(homeRel = 'h', candidates?: NodeCandidates, bakeHome = false): Fixture {
  const root = makeRealTmp('gournal-launcher-');
  roots.push(root);
  const home = path.join(root, homeRel);
  fs.mkdirSync(path.join(home, 'runtime', 'app-x', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(home, 'runtime', 'app-x', 'dist', 'cli.js'), '// app\n');
  fs.writeFileSync(path.join(home, 'runtime', 'current'), 'app-x\n');
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  const launcher = path.join(home, 'bin', 'gournal');
  fs.writeFileSync(launcher, renderPosixLauncher({ home, bakeHome, candidates }), { mode: 0o755 });
  return { root, home, launcher };
}

const none: NodeCandidates = { files: [], globs: [], system: [] };
const q = (...p: string[]): string => shellQuote(path.join(...p));

function run(f: Fixture, args: string[] = [], o: { path?: string; cwd?: string; input?: string; env?: Record<string, string> } = {}) {
  return spawnSync('/bin/sh', [f.launcher, ...args], {
    env: { HOME: path.join(f.root, 'user'), PATH: o.path ?? '', ...o.env },
    cwd: o.cwd ?? f.root,
    input: o.input ?? '',
    encoding: 'utf8',
  });
}

const rec = (f: Fixture): string => path.join(f.home, 'runtime', 'node');
const appPath = (f: Fixture): string => path.join(f.home, 'runtime', 'app-x', 'dist', 'cli.js');

describe('POSIX launcher', () => {
  posixTest('the recorded node wins over PATH', () => {
    const f = fixture('h', none);
    const r = path.join(f.root, 'rec', 'node');
    writeFakeNode(r, true);
    writeFakeNode(path.join(f.root, 'bin', 'node'), true);
    fs.writeFileSync(rec(f), `${r}\n`);
    const out = run(f, [], { path: path.join(f.root, 'bin') });
    expect(out.stdout).toContain(`node=${r}\n`);
  });

  posixTest('a dead record falls back to PATH and the record is rewritten', () => {
    const f = fixture('h', none);
    const p = path.join(f.root, 'bin', 'node');
    writeFakeNode(p, true);
    fs.writeFileSync(rec(f), `${path.join(f.root, 'gone', 'node')}\n`);
    const out = run(f, [], { path: path.join(f.root, 'bin') });
    expect(out.stdout).toContain(`node=${p}\n`);
    expect(fs.readFileSync(rec(f), 'utf8')).toBe(`${p}\n`);
  });

  posixTest('a recorded node that fails the probe is skipped', () => {
    const f = fixture('h', none);
    const bad = path.join(f.root, 'bad', 'node');
    const good = path.join(f.root, 'bin', 'node');
    writeFakeNode(bad, false);
    writeFakeNode(good, true);
    fs.writeFileSync(rec(f), `${bad}\n`);
    const out = run(f, [], { path: path.join(f.root, 'bin') });
    expect(out.stdout).toContain(`node=${good}\n`);
  });

  posixTest('a relative PATH result is never run', () => {
    const f = fixture('h', none);
    const cwd = path.join(f.root, 'proj');
    writeFakeNode(path.join(cwd, 'node'), true);
    writeFakeNode(path.join(cwd, 'bin', 'node'), true);
    const out = run(f, [], { path: '.:bin', cwd });
    expect(out.status).toBe(1);
    expect(out.stderr).toBe(NO_NODE);
    expect(out.stdout).toBe('');
  });

  posixTest('files come before globs, the last passing node of a glob wins, system comes last', () => {
    const f = fixture('h', none);
    const mk = (...p: string[]): string => {
      const file = path.join(f.root, ...p, 'node');
      writeFakeNode(file, !p.includes('bad'));
      return file;
    };
    const fileNode = mk('files');
    mk('g', 'v1');
    const newest = mk('g', 'v2');
    mk('g', 'v3', 'bad');
    const sys = mk('sys');
    const cands: NodeCandidates = {
      files: [q(fileNode)],
      globs: [`${shellQuote(path.join(f.root, 'g'))}/v*/node`],
      system: [q(sys)],
    };
    const launch = (c: NodeCandidates): string => {
      fs.writeFileSync(f.launcher, renderPosixLauncher({ home: f.home, bakeHome: false, candidates: c }));
      fs.rmSync(rec(f), { force: true });
      return run(f).stdout;
    };
    expect(launch(cands)).toContain(`node=${fileNode}\n`);
    expect(launch({ ...cands, files: [] })).toContain(`node=${newest}\n`);
    expect(launch({ ...cands, files: [], globs: [] })).toContain(`node=${sys}\n`);
  });

  posixTest('the first glob that yields a passing node wins over later globs', () => {
    const f = fixture('h', none);
    const first = path.join(f.root, 'g1', 'v1', 'node');
    const firstNewest = path.join(f.root, 'g1', 'v2', 'node');
    writeFakeNode(first, true);
    writeFakeNode(firstNewest, true);
    writeFakeNode(path.join(f.root, 'g2', 'v9', 'node'), true);
    const cands: NodeCandidates = {
      files: [],
      globs: ['g1', 'g2'].map((g) => `${shellQuote(path.join(f.root, g))}/v*/node`),
      system: [],
    };
    fs.writeFileSync(f.launcher, renderPosixLauncher({ home: f.home, bakeHome: false, candidates: cands }));
    expect(run(f).stdout).toContain(`node=${firstNewest}\n`);
  });

  posixTest('the first absolute PATH node fails the probe and a later one runs and is recorded', () => {
    const f = fixture('h', none);
    writeFakeNode(path.join(f.root, 'a', 'node'), false);
    const good = path.join(f.root, 'b', 'node');
    writeFakeNode(good, true);
    const out = run(f, [], { path: `${path.join(f.root, 'a')}:${path.join(f.root, 'b')}` });
    expect(out.stdout).toContain(`node=${good}\n`);
    expect(fs.readFileSync(rec(f), 'utf8')).toBe(`${good}\n`);
  });

  posixTest('no node: exit 1 with the exact message; hook: exit 0 and no output', () => {
    const f = fixture('h', none);
    const out = run(f);
    expect(out.status).toBe(1);
    expect(out.stderr).toBe(NO_NODE);
    const hook = run(f, ['hook']);
    expect(hook.status).toBe(0);
    expect(hook.stdout + hook.stderr).toBe('');
  });

  posixTest('a missing runtime/current gives the no-app message', () => {
    const f = fixture('h', none);
    fs.rmSync(path.join(f.home, 'runtime', 'current'));
    const out = run(f);
    expect(out.status).toBe(1);
    expect(out.stderr).toBe(
      `gournal: the launcher cannot find its copy of gournal in ${f.home}/runtime. Run "gournal setup claude" in a terminal.\n`,
    );
    const hook = run(f, ['hook']);
    expect(hook.status).toBe(0);
    expect(hook.stdout + hook.stderr).toBe('');
  });

  posixTest('stdin reaches the app unchanged', () => {
    const f = fixture('h', none);
    const r = path.join(f.root, 'rec', 'node');
    writeFakeNode(r, true);
    fs.writeFileSync(rec(f), `${r}\n`);
    const out = run(f, [], { input: 'line1\nline2\n' });
    expect(out.stdout.endsWith('line1\nline2\n')).toBe(true);
  });

  posixTest('stdin survives the PATH probe', () => {
    const f = fixture('h', none);
    writeFakeNode(path.join(f.root, 'bin', 'node'), true);
    const out = run(f, [], { path: path.join(f.root, 'bin'), input: 'first\n' });
    expect(out.stdout.endsWith('first\n')).toBe(true);
  });

  posixTest('arguments with spaces pass intact', () => {
    const f = fixture('h', none);
    const r = path.join(f.root, 'rec', 'node');
    writeFakeNode(r, true);
    fs.writeFileSync(rec(f), `${r}\n`);
    const out = run(f, ['a b', "c'd"]);
    expect(out.stdout).toContain(`args=${appPath(f)} a b c'd\n`);
  });

  posixTest('a home with a space and a quote works', () => {
    const f = fixture("Ann Lee's/.gournal", none, true);
    const r = path.join(f.root, 'rec', 'node');
    writeFakeNode(r, true);
    fs.writeFileSync(rec(f), `${r}\n`);
    const out = run(f, ['x']);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(`args=${appPath(f)} x\n`);
    expect(out.stdout).toContain(`home=${f.home}\n`);
  });

  posixTest('bakeHome exports GOURNAL_HOME only when it is unset', () => {
    const f = fixture('h', none, true);
    const r = path.join(f.root, 'rec', 'node');
    writeFakeNode(r, true);
    fs.writeFileSync(rec(f), `${r}\n`);
    expect(run(f).stdout).toContain(`home=${f.home}\n`);
    expect(run(f, [], { env: { GOURNAL_HOME: '/else' } }).stdout).toContain('home=/else\n');
    expect(run(f, [], { env: { GOURNAL_HOME: '' } }).stdout).toContain('home=\n');
    const plain = fixture('h', none, false);
    writeFakeNode(path.join(plain.root, 'rec', 'node'), true);
    fs.writeFileSync(rec(plain), `${path.join(plain.root, 'rec', 'node')}\n`);
    expect(run(plain).stdout).toContain('home=unset\n');
  });

  posixTest('the launcher runs by its shebang when it is executable', () => {
    const f = fixture('h', none);
    const r = path.join(f.root, 'rec', 'node');
    writeFakeNode(r, true);
    fs.writeFileSync(rec(f), `${r}\n`);
    const out = spawnSync(f.launcher, ['z'], { env: { PATH: '' }, encoding: 'utf8', input: '' });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(`args=${appPath(f)} z\n`);
  });

  posixTest('production list: an nvm layout under HOME is found with an empty PATH', () => {
    const f = fixture('h');
    const n = path.join(f.root, 'user', '.nvm', 'versions', 'node', 'v1', 'bin', 'node');
    writeFakeNode(n, true);
    const out = run(f);
    expect(out.stdout).toContain(`node=${n}\n`);
    expect(fs.readFileSync(rec(f), 'utf8')).toBe(`${n}\n`);
  });

  posixTest('production list: an fnm default alias under XDG data is found', () => {
    const f = fixture('h');
    const n = path.join(f.root, 'user', '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node');
    writeFakeNode(n, true);
    expect(run(f).stdout).toContain(`node=${n}\n`);
  });
});

describe('launcher text', () => {
  test('production lists hold every layout in order', () => {
    const text = renderPosixLauncher({ home: '/h', bakeHome: false });
    const all = [...POSIX_CANDIDATES.files, ...POSIX_CANDIDATES.globs, ...POSIX_CANDIDATES.system];
    const at = all.map((f) => text.indexOf(f));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const token of Object.values(INSTALL_FAMILIES)) expect(all.some((f) => f.includes(token))).toBe(true);
    const win = renderWindowsLauncher({ bakeHome: false });
    const wall = [...WINDOWS_CANDIDATES.files, ...WINDOWS_CANDIDATES.globs, ...WINDOWS_CANDIDATES.system];
    const wat = wall.map((f) => win.indexOf(f));
    expect(wat.every((i) => i >= 0)).toBe(true);
    expect(wat).toEqual([...wat].sort((a, b) => a - b));
  });

  test('the POSIX system list holds the Homebrew opt paths before the bin links for all three prefixes', () => {
    const s = POSIX_CANDIDATES.system;
    for (const p of ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew']) {
      expect(s.indexOf(`${p}/opt/node/bin/node`)).toBeGreaterThanOrEqual(0);
      expect(s.indexOf(`${p}/opt/node/bin/node`)).toBeLessThan(s.indexOf(`${p}/bin/node`));
      expect(POSIX_CANDIDATES.globs).toContain(`${p}/opt/node@*/bin/node`);
    }
  });

  test('the Windows launcher uses CRLF, no delayed expansion, and ends with the node line', () => {
    const text = renderWindowsLauncher({ bakeHome: true });
    expect(text.split('\r\n').length).toBeGreaterThan(20);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text).toContain('setlocal EnableExtensions DisableDelayedExpansion');
    expect(text).not.toMatch(/EnableDelayedExpansion/);
    expect(text).toContain('if not defined GOURNAL_HOME set "GOURNAL_HOME=%GH%"');
    const node = '"%PICK%" "%GH%\\runtime\\%APP%\\dist\\cli.js" %*\r\n';
    expect(text.endsWith(`\r\n:run\r\n(goto) 2>nul & set "GOURNAL_HOME=%GOURNAL_HOME%" & ${node}`)).toBe(true);
    expect(renderWindowsLauncher({ bakeHome: false }).endsWith(`\r\n:run\r\n(goto) 2>nul & ${node}`)).toBe(true);
    expect(text).not.toMatch(/exit 0|exit 1/);
    expect(renderWindowsLauncher({ bakeHome: false })).not.toContain('GOURNAL_HOME');
  });

  test('launcherCommand and checkLauncherPath', () => {
    expect(launcherCommand('/h/bin/gournal', 'linux', 'C:\\Windows\\System32\\cmd.exe')).toEqual({ command: '/h/bin/gournal', args: [] });
    expect(launcherCommand('C:\\Users\\Ann Lee\\.gournal\\bin\\gournal.cmd', 'win32', 'C:\\Windows\\System32\\cmd.exe'))
      .toEqual({ command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c', 'C:\\Users\\Ann Lee\\.gournal\\bin\\gournal.cmd'] });
    expect(checkLauncherPath('C:\\Users\\A (B)\\.gournal\\bin\\gournal.cmd', 'win32')).toContain('Set GOURNAL_HOME');
    expect(checkLauncherPath('/a (b)/bin/gournal', 'linux')).toBeNull();
  });
});

describe('Windows launcher', () => {
  const sys = process.env.SystemRoot ?? 'C:\\Windows';

  function winFixture(homeRel = 'h'): { root: string; home: string; launcher: string; node: string } {
    const root = makeRealTmp('gournal-launcher-');
    roots.push(root);
    const home = path.join(root, homeRel);
    fs.mkdirSync(path.join(home, 'runtime', 'app-x', 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'runtime', 'app-x', 'dist', 'cli.js'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.APP_EXIT || 0))',
    );
    fs.writeFileSync(path.join(home, 'runtime', 'current'), 'app-x\r\n');
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    const launcher = path.join(home, 'bin', 'gournal.cmd');
    fs.writeFileSync(launcher, renderWindowsLauncher({ bakeHome: false }));
    const node = path.join(root, 'nodes', 'a', 'node.exe');
    fs.mkdirSync(path.dirname(node), { recursive: true });
    fs.copyFileSync(process.execPath, node);
    return { root, home, launcher, node };
  }

  function bakedFixture(): ReturnType<typeof winFixture> {
    const f = winFixture();
    fs.writeFileSync(f.launcher, renderWindowsLauncher({ bakeHome: true }));
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${f.node}\r\n`);
    fs.writeFileSync(
      path.join(f.home, 'runtime', 'app-x', 'dist', 'cli.js'),
      "process.stdout.write(process.env.GOURNAL_HOME ?? 'unset')",
    );
    return f;
  }

  function runWith(f: { root: string; launcher: string }, extra: Record<string, string>) {
    return spawnSync(process.env.ComSpec ?? `${sys}\\System32\\cmd.exe`, ['/d', '/c', f.launcher], {
      env: { SystemRoot: sys, USERPROFILE: f.root, PATH: `${sys}\\System32`, ...extra },
      encoding: 'utf8',
    });
  }

  windowsTest('bakeHome gives the app the launcher home when GOURNAL_HOME is unset', () => {
    const f = bakedFixture();
    const out = runWith(f, {});
    expect({ status: out.status, stdout: out.stdout, stderr: out.stderr }).toMatchObject({ status: 0, stdout: f.home });
  });

  windowsTest('bakeHome keeps a GOURNAL_HOME that is already set', () => {
    const f = bakedFixture();
    const other = path.join(f.root, 'other');
    const out = runWith(f, { GOURNAL_HOME: other });
    expect({ status: out.status, stdout: out.stdout, stderr: out.stderr }).toMatchObject({ status: 0, stdout: other });
  });

  function runWin(f: { root: string; launcher: string }, args: string[], appExit = '0', o: { cwd?: string; path?: string } = {}) {
    return spawnSync(process.env.ComSpec ?? `${sys}\\System32\\cmd.exe`, ['/d', '/c', f.launcher, ...args], {
      env: { SystemRoot: sys, USERPROFILE: f.root, PATH: o.path ?? `${sys}\\System32`, APP_EXIT: appExit },
      cwd: o.cwd,
      encoding: 'utf8',
    });
  }

  windowsTest('the recorded node.exe runs the app with the arguments', () => {
    const f = winFixture();
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${f.node}\r\n`);
    const out = runWin(f, ['a', 'b']);
    expect(out.stdout).toBe('["a","b"]');
  });

  windowsTest('the exit code of the app passes through cmd.exe', () => {
    const f = winFixture();
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${f.node}\r\n`);
    const out = runWin(f, [], '3');
    expect({ status: out.status, stdout: out.stdout, stderr: out.stderr }).toMatchObject({ status: 3 });
  });

  windowsTest('a home with a space works', () => {
    const f = winFixture('Ann Lee\\.gournal');
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${f.node}\r\n`);
    expect(runWin(f, ['x']).stdout).toBe('["x"]');
  });

  windowsTest('a dead record falls back to a glob candidate and rewrites the record', () => {
    const f = winFixture();
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${path.join(f.root, 'gone', 'node.exe')}\r\n`);
    const v = path.join(f.root, 'AppData', 'Roaming', 'nvm', 'v1', 'node.exe');
    fs.mkdirSync(path.dirname(v), { recursive: true });
    fs.copyFileSync(process.execPath, v);
    const out = spawnSync(process.env.ComSpec ?? `${sys}\\System32\\cmd.exe`, ['/d', '/c', f.launcher], {
      env: { SystemRoot: sys, USERPROFILE: f.root, APPDATA: path.join(f.root, 'AppData', 'Roaming'), PATH: `${sys}\\System32` },
      encoding: 'utf8',
    });
    expect(out.stdout).toBe('[]');
    expect(fs.readFileSync(path.join(f.home, 'runtime', 'node'), 'utf8').trim()).toBe(v);
  });

  function relativePathCase(form: 'plain' | 'long' | 'short'): void {
    const f = winFixture();
    const proj = path.join(f.root, 'proj');
    fs.mkdirSync(path.join(proj, 'bin'), { recursive: true });
    fs.copyFileSync(process.execPath, path.join(proj, 'bin', 'node.exe'));
    fs.writeFileSync(path.join(f.home, 'runtime', 'app-x', 'dist', 'cli.js'), 'process.stdout.write(process.execPath)');
    const cmd = process.env.ComSpec ?? `${sys}\\System32\\cmd.exe`;
    let cwd = proj;
    if (form !== 'plain') {
      const long = fs.realpathSync.native(proj);
      const r = spawnSync(cmd, ['/d', '/c', 'for %I in (.) do @echo %~fsI'], { cwd: proj, encoding: 'utf8' });
      const short = r.stdout.trim();
      if (short === '' || short.toLowerCase() === long.toLowerCase()) {
        const why = `no 8.3 short name for ${long} (short form: "${short}")`;
        if (process.env.CI) throw new Error(why);
        console.warn(`skipped: ${why}`);
        return;
      }
      cwd = form === 'long' ? long : short;
    }
    const env = { SystemRoot: sys, USERPROFILE: f.root, PATH: `bin;${sys}\\System32` };
    const where = spawnSync(cmd, ['/d', '/c', 'cd & where node'], { env, cwd, encoding: 'utf8' });
    const out = runWin(f, [], '0', { cwd, path: env.PATH });
    if (out.status !== 1 || out.stdout !== '' || !out.stderr.includes('gournal: found no Node.js 22.13 or newer')) {
      throw new Error(
        JSON.stringify({ status: out.status, stdout: out.stdout, stderr: out.stderr, cwd, cdAndWhere: where.stdout, whereErr: where.stderr }, null, 2),
      );
    }
  }

  windowsTest('a node.exe found through a relative PATH entry is never run', () => relativePathCase('plain'));

  windowsTest('a relative PATH node is never run when the current folder is given in its long form', () => relativePathCase('long'));

  windowsTest('a relative PATH node is never run when the current folder is given in its 8.3 form', () => relativePathCase('short'));

  windowsTest('the launcher folder can be deleted by the app and the app exit code still comes back', () => {
    const f = winFixture();
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${f.node}\r\n`);
    const bin = path.dirname(f.launcher);
    fs.writeFileSync(
      path.join(f.home, 'runtime', 'app-x', 'dist', 'cli.js'),
      `require('fs').rmSync(${JSON.stringify(bin)}, { recursive: true, force: true }); process.exit(3)`,
    );
    const out = runWin(f, []);
    expect(fs.existsSync(bin)).toBe(false);
    expect({ status: out.status, stdout: out.stdout, stderr: out.stderr }).toMatchObject({ status: 3 });
    expect(out.stderr).not.toMatch(/cannot find/i);
  });

  windowsTest('a node path with an ampersand is recorded whole', () => {
    const f = winFixture();
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${path.join(f.root, 'gone', 'node.exe')}\r\n`);
    const roaming = path.join(f.root, 'R&D', 'Roaming');
    const v = path.join(roaming, 'nvm', 'v1', 'node.exe');
    fs.mkdirSync(path.dirname(v), { recursive: true });
    fs.copyFileSync(process.execPath, v);
    const out = spawnSync(process.env.ComSpec ?? `${sys}\\System32\\cmd.exe`, ['/d', '/c', f.launcher], {
      env: { SystemRoot: sys, USERPROFILE: f.root, APPDATA: roaming, PATH: `${sys}\\System32` },
      encoding: 'utf8',
    });
    expect(out.stdout).toBe('[]');
    expect(fs.readFileSync(path.join(f.home, 'runtime', 'node'), 'utf8').trim()).toBe(v);
  });

  windowsTest('the first glob that yields a passing node wins over later globs', () => {
    const f = winFixture();
    fs.writeFileSync(path.join(f.home, 'runtime', 'node'), `${path.join(f.root, 'gone', 'node.exe')}\r\n`);
    const local = path.join(f.root, 'Local', 'nvm', 'v1', 'node.exe');
    const roaming = path.join(f.root, 'Roaming', 'nvm', 'v9', 'node.exe');
    for (const n of [local, roaming]) {
      fs.mkdirSync(path.dirname(n), { recursive: true });
      fs.copyFileSync(process.execPath, n);
    }
    const out = spawnSync(process.env.ComSpec ?? `${sys}\\System32\\cmd.exe`, ['/d', '/c', f.launcher], {
      env: {
        SystemRoot: sys,
        USERPROFILE: f.root,
        LOCALAPPDATA: path.join(f.root, 'Local'),
        APPDATA: path.join(f.root, 'Roaming'),
        PATH: `${sys}\\System32`,
      },
      encoding: 'utf8',
    });
    expect({ status: out.status, stderr: out.stderr }).toMatchObject({ status: 0 });
    expect(fs.readFileSync(path.join(f.home, 'runtime', 'node'), 'utf8').trim()).toBe(local);
  });
});
