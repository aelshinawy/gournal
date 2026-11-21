import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { INSTALL_FAMILIES } from '../../src/adapters/setup/launcher';
import { CLEANUP_AFTER_S, MCP_GRACE_S, installGate } from '../../src/adapters/setup/install-gate';
import { findOtherInstall, readRecords, sourceRecords, writeRecords, type SourceRecords } from '../../src/adapters/setup/source';
import { canSymlink } from '../helpers/symlink';
import { runCli } from '../../src/adapters/cli/program';

const roots: string[] = [];
afterAll(() => roots.forEach(rmTmp));
const now = new Date('2026-11-21T12:00:00Z');

interface Fx {
  root: string;
  home: string;
  copy: string;
  pm: string;
  source: string;
  removedAt: string;
  find: { exists(p: string): boolean; readdir(p: string): string[] };
}

/** A copy at <home>/runtime/app-x, and records that name a package manager folder (the anchor) and a rack. */
function setup(records?: (root: string) => SourceRecords): Fx {
  const root = makeRealTmp('gournal-gate-');
  roots.push(root);
  const home = path.join(root, 'home');
  const copy = path.join(home, 'runtime', 'app-x');
  fs.mkdirSync(path.join(copy, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'dist', 'cli.js'), '// copy\n');
  const pm = path.join(root, 'pm', 'node_modules');
  const source = path.join(pm, 'gournal');
  fs.mkdirSync(pm, { recursive: true });
  writeRecords(path.join(home, 'runtime'), records ? records(root) : { source, anchor: pm, rack: source });
  const inRoot = (p: string): boolean => p.startsWith(root);
  return {
    root, home, copy, pm, source,
    removedAt: path.join(home, 'runtime', 'removed-at'),
    find: {
      exists: (p) => inRoot(p) && fs.existsSync(p),
      readdir: (p) => (inRoot(p) && fs.existsSync(p) ? fs.readdirSync(p) : []),
    },
  };
}

const gateFor = (f: Fx, packageRoot = f.copy, at = now) => (argv: string[]) =>
  installGate({ argv, packageRoot, gournalHome: f.home, userHome: path.join(f.root, 'user'), now: at, env: {}, platform: 'linux', find: f.find });

const ago = (f: Fx, s: number): void => fs.writeFileSync(f.removedAt, `${Math.floor(now.getTime() / 1000) - s}\n`);
const install = (f: Fx): void => {
  fs.mkdirSync(path.join(f.source, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(f.source, 'dist', 'cli.js'), '// source\n');
};
const MCP = ['node', 'gournal', 'mcp'];
const HOOK = ['node', 'gournal', 'hook', 'stop'];

test('the timers are 60 and 3600 seconds', () => {
  expect([MCP_GRACE_S, CLEANUP_AFTER_S]).toEqual([60, 3600]);
});

test('outside copy mode the gate runs and deletes removed-at', () => {
  const f = setup();
  ago(f, 5000);
  expect(gateFor(f, path.join(f.root, 'pkg'))(MCP)).toEqual({ kind: 'run' });
  expect(fs.existsSync(f.removedAt)).toBe(false);
});

test('an installed source runs and deletes removed-at', () => {
  const f = setup();
  install(f);
  ago(f, 5000);
  expect(gateFor(f)(MCP)).toEqual({ kind: 'run' });
  expect(fs.existsSync(f.removedAt)).toBe(false);
});

test('a removed Node.js version is not an uninstall', () => {
  const f = setup();
  fs.rmSync(path.join(f.root, 'pm'), { recursive: true }); // the anchor goes too
  ago(f, 5000);
  expect(gateFor(f)(MCP)).toEqual({ kind: 'run' });
  expect(gateFor(f)(HOOK)).toEqual({ kind: 'run' });
  expect(fs.existsSync(f.removedAt)).toBe(false);
});

function brewFixture(): Fx & { prefix: string } {
  let prefix = '';
  const f = setup((root) => {
    prefix = path.join(root, 'brew');
    return { source: `${prefix}/opt/gournal/libexec/lib/node_modules/gournal`, anchor: `${prefix}/Cellar`, rack: `${prefix}/Cellar/gournal` };
  });
  fs.mkdirSync(path.join(prefix, 'Cellar'), { recursive: true });
  return { ...f, prefix };
}

test('a Homebrew upgrade window is not an uninstall', () => {
  const f = brewFixture();
  fs.mkdirSync(path.join(f.prefix, 'Cellar', 'gournal', '2.0.0'), { recursive: true }); // rack present, opt link missing
  expect(gateFor(f)(MCP)).toEqual({ kind: 'run' });
  expect(fs.existsSync(f.removedAt)).toBe(false);
});

describe('npm uninstall', () => {
  const notice = (f: Fx): string => `gournal: the installed package ${f.source} is missing. gournal runs from its copy in ${f.home}/runtime.`;
  const gone = (f: Fx): string =>
    `gournal: gournal is no longer installed: ${f.source} is gone. To remove gournal from Claude Code, run: ${path.join(f.home, 'bin', 'gournal')} setup claude --uninstall`;

  test('the first run writes removed-at and mcp runs from the copy with the notice', () => {
    const f = setup();
    expect(gateFor(f)(MCP)).toEqual({ kind: 'run', notice: notice(f) });
    expect(fs.readFileSync(f.removedAt, 'utf8')).toBe(`${Math.floor(now.getTime() / 1000)}\n`);
  });

  test('mcp at 59 s runs from the copy with the notice; the hook runs silently', () => {
    const f = setup();
    ago(f, 59);
    expect(gateFor(f)(MCP)).toEqual({ kind: 'run', notice: notice(f) });
    expect(gateFor(f)(HOOK)).toEqual({ kind: 'run' });
  });

  test('mcp at 61 s exits 1 with the uninstalled line; the hook still runs silently and does not clean up', () => {
    const f = setup();
    ago(f, 61);
    expect(gateFor(f)(MCP)).toEqual({ kind: 'exit', code: 1, message: gone(f) });
    expect(gateFor(f)(HOOK)).toEqual({ kind: 'run' });
  });

  test('the hook at 3599 s runs, and at 3600 s cleans up; setup --uninstall always runs', () => {
    const f = setup();
    ago(f, 3599);
    expect(gateFor(f)(HOOK)).toEqual({ kind: 'run' });
    ago(f, 3600);
    expect(gateFor(f)(HOOK)).toEqual({ kind: 'cleanup' });
    expect(gateFor(f)(['node', 'gournal', 'setup', 'claude', '--uninstall'])).toEqual({ kind: 'run' });
  });

  test('a restored package deletes removed-at again', () => {
    const f = setup();
    ago(f, 100);
    install(f);
    expect(gateFor(f)(MCP)).toEqual({ kind: 'run' });
    expect(fs.existsSync(f.removedAt)).toBe(false);
  });

  test.each([['zero', '0'], ['small', '5'], ['negative', '-1'], ['future', String(Math.floor(now.getTime() / 1000) + 99999)], ['corrupt', 'abc'], ['empty', '']])(
    'a %s marker starts the clock now: the hook does not clean up',
    (_name, text) => {
      const f = setup();
      fs.writeFileSync(f.removedAt, `${text}\n`);
      expect(gateFor(f)(HOOK)).toEqual({ kind: 'run' });
      expect(fs.readFileSync(f.removedAt, 'utf8')).toBe(`${Math.floor(now.getTime() / 1000)}\n`);
    },
  );

  test('mcp at 3600 s or more exits, and never cleans up', () => {
    const f = setup();
    ago(f, 99999);
    expect(gateFor(f)(MCP)).toEqual({ kind: 'exit', code: 1, message: gone(f) });
  });

  test('only "hook stop" is silent and cleans up; another hook command follows the normal rules', () => {
    const f = setup();
    ago(f, 5000);
    expect(gateFor(f)(['node', 'gournal', 'hook'])).toEqual({ kind: 'exit', code: 1, message: gone(f) });
    expect(gateFor(f)(['node', 'gournal', 'hook', 'start'])).toEqual({ kind: 'exit', code: 1, message: gone(f) });
    expect(gateFor(f)(HOOK)).toEqual({ kind: 'cleanup' });
  });

  test('a checkout or npm link that goes away is not an uninstall', () => {
    const f = setup((root) => {
      const checkout = path.join(root, 'work', 'gournal');
      fs.mkdirSync(path.join(checkout, 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(checkout, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(checkout, 'dist', 'cli.js'), '');
      fs.writeFileSync(path.join(checkout, 'package.json'), '{}');
      return sourceRecords(checkout, null);
    });
    const checkout = path.join(f.root, 'work', 'gournal');
    expect(readRecords(path.join(f.home, 'runtime'))!.anchor).toBe(path.join(checkout, 'node_modules'));
    fs.rmSync(checkout, { recursive: true });
    ago(f, 5000);
    expect(gateFor(f)(HOOK)).toEqual({ kind: 'run' });
    expect(gateFor(f)(MCP)).toEqual({ kind: 'run' });
    expect(fs.existsSync(f.removedAt)).toBe(false);
  });

  test('brew uninstall at 61 s gives the same line', () => {
    const f = brewFixture(); // Cellar present, Cellar/gournal gone
    ago(f, 61);
    expect(gateFor(f)(MCP)).toEqual({
      kind: 'exit',
      code: 1,
      message: `gournal: gournal is no longer installed: ${f.prefix}/opt/gournal/libexec/lib/node_modules/gournal is gone. To remove gournal from Claude Code, run: ${path.join(f.home, 'bin', 'gournal')} setup claude --uninstall`,
    });
  });
});

const symlinkTest = canSymlink() ? test : test.skip;

symlinkTest('the messages name the home as the user spells it, not its real path', () => {
  const f = setup();
  const spelled = path.join(f.root, 'link');
  fs.symlinkSync(f.home, spelled, 'junction');
  const result = installGate({
    argv: MCP, packageRoot: f.copy, gournalHome: spelled, userHome: path.join(f.root, 'user'),
    now, env: {}, platform: 'linux', find: f.find,
  });
  expect(result).toEqual({ kind: 'run', notice: `gournal: the installed package ${f.source} is missing. gournal runs from its copy in ${spelled}/runtime.` });
});

test('another install under nvm becomes the source', () => {
  const f = setup();
  ago(f, 5000);
  const other = path.join(f.root, 'nvm', 'versions', 'node', 'v2', 'lib', 'node_modules', 'gournal');
  fs.mkdirSync(path.join(other, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(other, 'dist', 'cli.js'), '// other\n');
  const result = installGate({
    argv: MCP, packageRoot: f.copy, gournalHome: f.home, userHome: path.join(f.root, 'user'),
    now, env: { NVM_DIR: path.join(f.root, 'nvm') }, platform: 'linux', find: f.find,
  });
  expect(result).toEqual({ kind: 'run' });
  expect(readRecords(path.join(f.home, 'runtime'))).toEqual({ source: other, anchor: path.dirname(other), rack: other });
  expect(fs.existsSync(f.removedAt)).toBe(false);
});

describe('findOtherInstall', () => {
  /** A fake file system that holds only the given files. */
  function fakeFs(files: string[]) {
    const all = new Set<string>();
    for (const file of files) {
      const sep = file.includes('\\') ? '\\' : '/';
      const parts = file.split(sep);
      for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join(sep));
    }
    return {
      exists: (p: string) => all.has(p),
      readdir: (p: string) => {
        const prefix = p.includes('\\') ? `${p}\\` : `${p}/`;
        return [...all].filter((e) => e.startsWith(prefix) && !/[\\/]/.test(e.slice(prefix.length))).map((e) => e.slice(prefix.length));
      },
    };
  }
  const home = '/u';
  const cases: Record<string, string> = {
    nvm: '/u/.nvm/versions/node/v22.1.0/lib/node_modules/gournal',
    fnm: '/u/.local/share/fnm/node-versions/v22.1.0/installation/lib/node_modules/gournal',
    asdf: '/u/.asdf/installs/nodejs/22.1.0/lib/node_modules/gournal',
    mise: '/u/.local/share/mise/installs/node/22.1.0/lib/node_modules/gournal',
    nodenv: '/u/.nodenv/versions/22.1.0/lib/node_modules/gournal',
    n: '/usr/local/n/versions/node/22.1.0/lib/node_modules/gournal',
    homebrew: '/opt/homebrew/opt/gournal/libexec/lib/node_modules/gournal',
  };

  test('it covers every family of INSTALL_FAMILIES except volta', () => {
    expect(Object.keys(cases).sort()).toEqual(Object.keys(INSTALL_FAMILIES).filter((k) => k !== 'volta').sort());
    for (const dir of Object.values(cases)) {
      const vfs = fakeFs([`${dir}/dist/cli.js`]);
      expect(findOtherInstall({ userHome: home, env: {}, platform: 'linux', ...vfs })).toBe(dir);
    }
  });

  test('it finds the plain npm prefixes, uses the env bases, and skips a folder without dist/cli.js', () => {
    for (const dir of ['/u/.npm-global/lib/node_modules/gournal', '/usr/local/lib/node_modules/gournal', '/usr/lib/node_modules/gournal', '/opt/homebrew/lib/node_modules/gournal']) {
      expect(findOtherInstall({ userHome: home, env: {}, platform: 'linux', ...fakeFs([`${dir}/dist/cli.js`]) })).toBe(dir);
    }
    const env = { NVM_DIR: '/x/nvm', FNM_DIR: '/x/fnm', N_PREFIX: '/x/n' };
    const nvm = '/x/nvm/versions/node/v1/lib/node_modules/gournal';
    const fnm = '/x/fnm/node-versions/v1/installation/lib/node_modules/gournal';
    const n = '/x/n/n/versions/node/v1/lib/node_modules/gournal';
    for (const dir of [nvm, fnm, n]) {
      expect(findOtherInstall({ userHome: home, env, platform: 'linux', ...fakeFs([`${dir}/dist/cli.js`]) })).toBe(dir);
    }
    expect(findOtherInstall({ userHome: home, env: {}, platform: 'linux', ...fakeFs([`${cases.nvm}/package.json`]) })).toBeNull();
  });

  test('the first match wins, and a Volta package has no entry', () => {
    const vfs = fakeFs([`${cases.nvm}/dist/cli.js`, `${cases.asdf}/dist/cli.js`]);
    expect(findOtherInstall({ userHome: home, env: {}, platform: 'linux', ...vfs })).toBe(cases.nvm);
    const volta = '/u/.volta/tools/image/packages/gournal/lib/node_modules/gournal';
    expect(findOtherInstall({ userHome: home, env: {}, platform: 'linux', ...fakeFs([`${volta}/dist/cli.js`]) })).toBeNull();
  });

  test('on Windows it reads the APPDATA and nvm folders', () => {
    const env = { APPDATA: 'C:\\U\\AppData\\Roaming', LOCALAPPDATA: 'C:\\U\\AppData\\Local' };
    for (const dir of ['C:\\U\\AppData\\Roaming\\npm\\node_modules\\gournal', 'C:\\U\\AppData\\Local\\nvm\\v22.1.0\\node_modules\\gournal']) {
      expect(findOtherInstall({ userHome: 'C:\\U', env, platform: 'win32', ...fakeFs([`${dir}\\dist\\cli.js`]) })).toBe(dir);
    }
  });
});

describe('runCli', () => {
  async function runGate(f: Fx, argv: string[], at: Date = now, stdin = '{}') {
    const out: string[] = [];
    const err: string[] = [];
    const saved = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', { value: Readable.from([stdin]), configurable: true });
    try {
      const status = await runCli(['node', 'gournal', ...argv], {
        home: f.home, packageRoot: f.copy, userHome: path.join(f.root, 'user'), now: () => at, gateFind: f.find,
        out: (t) => out.push(t), err: (t) => err.push(t), runtimeRefresh: () => {},
        exec: async () => ({ code: 127, stdout: '', stderr: '' }),
      });
      return { status, out, err };
    } finally {
      Object.defineProperty(process, 'stdin', saved);
    }
  }
  test('it writes the notice and the exit message to stderr only, never to stdout; the hook prints nothing at 59 s and at 61 s', async () => {
    const f = setup();
    ago(f, 0);
    const first = await runGate(f, ['--version']);
    expect(first.status).toBe(0);
    expect(first.err).toEqual([`gournal: the installed package ${f.source} is missing. gournal runs from its copy in ${f.home}/runtime.`]);
    expect(first.out.join('')).toMatch(/^\d+\.\d+\.\d+/);
    // The marker is old now. Move the clock, not the file.
    const later59 = await runGate(f, ['hook', 'stop'], new Date(now.getTime() + 59_000));
    expect({ status: later59.status, out: later59.out, err: later59.err }).toEqual({ status: 0, out: [], err: [] });
    const later61 = await runGate(f, ['hook', 'stop'], new Date(now.getTime() + 61_000));
    expect({ status: later61.status, out: later61.out, err: later61.err }).toEqual({ status: 0, out: [], err: [] });
  });

  test('it prints the exit message plainly and returns 1, and returns 0 with no output after cleanup', async () => {
    const f = setup();
    ago(f, 0);
    const exited = await runGate(f, ['--version'], new Date(now.getTime() + 61_000));
    expect(exited.status).toBe(1);
    expect(exited.out).toEqual([]);
    expect(exited.err).toEqual([
      `gournal: gournal is no longer installed: ${f.source} is gone. To remove gournal from Claude Code, run: ${path.join(f.home, 'bin', 'gournal')} setup claude --uninstall`,
    ]);
    expect(exited.err[0]).not.toContain('\u001b');
    const cleaned = await runGate(f, ['hook', 'stop'], new Date(now.getTime() + 3600_000));
    expect({ status: cleaned.status, out: cleaned.out, err: cleaned.err }).toEqual({ status: 0, out: [], err: [] });
    expect(fs.existsSync(path.join(f.home, 'runtime'))).toBe(false);
  });
});
