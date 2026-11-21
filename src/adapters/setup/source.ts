import fs from 'fs';
import path from 'path';
import { writeViaTemp } from '../../storage';
import type { HomebrewInstall } from './homebrew';

/**
 * Where the installed package lives, in three paths:
 * `source` is the package folder that the launcher runs. `anchor` exists while the package manager
 * still exists. `rack` is the path that an uninstall removes.
 */
export interface SourceRecords { source: string; anchor: string; rack: string }
export type Verdict = 'installed' | 'uninstalled' | 'away';

const FILES = ['source', 'anchor', 'rack'] as const;

export function sourceRecords(packageRoot: string, brew: HomebrewInstall | null): SourceRecords {
  if (brew) return { source: brew.source, anchor: `${brew.prefix}/Cellar`, rack: `${brew.prefix}/Cellar/gournal` };
  const source = fs.realpathSync(packageRoot);
  // A checkout or an npm link is not under node_modules. Its parent folder stays when the checkout
  // goes, so the anchor is a folder inside the source, and removing the source gives "away".
  const installed = source.split(path.sep).includes('node_modules');
  return { source, anchor: installed ? path.dirname(source) : path.join(source, 'node_modules'), rack: source };
}

/** Write the three records. Returns true when a file changed. */
export function writeRecords(runtimeDir: string, records: SourceRecords): boolean {
  let wrote = false;
  for (const name of FILES) {
    const file = path.join(runtimeDir, name);
    const text = `${records[name]}\n`;
    let have: string | null = null;
    try {
      have = fs.readFileSync(file, 'utf8');
    } catch {
      // No file yet.
    }
    if (have === text) continue;
    writeViaTemp(file, (tmp) => fs.writeFileSync(tmp, text));
    wrote = true;
  }
  return wrote;
}

/** Read the three records. Returns null when one is missing or empty. */
export function readRecords(runtimeDir: string): SourceRecords | null {
  const out: Partial<SourceRecords> = {};
  for (const name of FILES) {
    try {
      const line = (fs.readFileSync(path.join(runtimeDir, name), 'utf8').split(/\r?\n/)[0] ?? '').trim();
      if (line === '') return null;
      out[name] = line;
    } catch {
      return null;
    }
  }
  return out as SourceRecords;
}

/**
 * `installed`: the source still runs. `uninstalled`: the package manager is still there and the rack is gone.
 * `away`: the anchor is gone too. A Node.js version was removed, or an upgrade is in progress.
 */
export function uninstallVerdict(records: SourceRecords, exists: (p: string) => boolean): Verdict {
  if (exists(path.join(records.source, 'dist', 'cli.js'))) return 'installed';
  return exists(records.anchor) && !exists(records.rack) ? 'uninstalled' : 'away';
}

interface FindFs {
  exists(p: string): boolean;
  readdir(p: string): string[];
}

const realFs: FindFs = {
  exists: (p) => fs.existsSync(p),
  readdir: (p) => {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  },
};

const BREW_PREFIXES = ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew'];
const PKG = 'node_modules/gournal';

/** The folders that can hold a gournal install, one string per place. A `*` stands for one folder level. */
function posixPatterns(home: string, env: NodeJS.ProcessEnv): string[] {
  const xdg = env.XDG_DATA_HOME || `${home}/.local/share`;
  const fnm = [env.FNM_DIR, `${xdg}/fnm`, `${home}/Library/Application Support/fnm`, `${home}/.fnm`].filter((b): b is string => !!b);
  return [
    `${env.NVM_DIR || `${home}/.nvm`}/versions/node/*/lib/${PKG}`,
    ...fnm.map((b) => `${b}/node-versions/*/installation/lib/${PKG}`),
    `${env.ASDF_DATA_DIR || `${home}/.asdf`}/installs/nodejs/*/lib/${PKG}`,
    `${env.MISE_DATA_DIR || `${xdg}/mise`}/installs/node/*/lib/${PKG}`,
    `${env.NODENV_ROOT || `${home}/.nodenv`}/versions/*/lib/${PKG}`,
    `${env.N_PREFIX || '/usr/local'}/n/versions/node/*/lib/${PKG}`,
    ...BREW_PREFIXES.flatMap((p) => [`${p}/opt/gournal/libexec/lib/${PKG}`, `${p}/lib/${PKG}`]),
    `${home}/.npm-global/lib/${PKG}`,
    `${home}/.local/lib/${PKG}`,
    `/usr/local/lib/${PKG}`,
    `/usr/lib/${PKG}`,
  ];
}

function windowsPatterns(env: NodeJS.ProcessEnv): string[] {
  const at = (base: string | undefined, rest: string): string[] => (base ? [`${base}\\${rest}`] : []);
  return [
    ...at(env.APPDATA, 'npm\\node_modules\\gournal'),
    ...at(env.NVM_HOME, 'v*\\node_modules\\gournal'),
    ...at(env.LOCALAPPDATA, 'nvm\\v*\\node_modules\\gournal'),
    ...at(env.APPDATA, 'nvm\\v*\\node_modules\\gournal'),
    ...at(env.APPDATA, 'fnm\\node-versions\\*\\installation\\node_modules\\gournal'),
    ...at(env.ProgramFiles, 'nodejs\\node_modules\\gournal'),
  ];
}

function expand(pattern: string, sep: string, vfs: FindFs): string[] {
  let found = [''];
  pattern.split(sep).forEach((piece, i) => {
    const join = (base: string, name: string): string => (i === 0 ? name : `${base}${sep}${name}`);
    if (!piece.includes('*')) {
      found = found.map((base) => join(base, piece));
      return;
    }
    const rx = new RegExp(`^${piece.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    found = found.flatMap((base) => vfs.readdir(base).filter((n) => rx.test(n)).sort().map((n) => join(base, n)));
  });
  return found;
}

/**
 * Find a gournal install of another Node.js version or another package manager. Returns its package
 * folder, or null. A match must hold dist/cli.js. The first match wins. Volta has no entry: a Volta
 * global package has no anchor.
 */
export function findOtherInstall(o: {
  userHome: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exists?: (p: string) => boolean;
  readdir?: (p: string) => string[];
}): string | null {
  const vfs: FindFs = { exists: o.exists ?? realFs.exists, readdir: o.readdir ?? realFs.readdir };
  const win = o.platform === 'win32';
  const sep = win ? '\\' : '/';
  const patterns = win ? windowsPatterns(o.env) : posixPatterns(o.userHome, o.env);
  for (const pattern of patterns) {
    for (const match of expand(pattern, sep, vfs)) {
      if (vfs.exists(`${match}${sep}dist${sep}cli.js`)) return match;
    }
  }
  return null;
}

/** The home of a copy when `packageRoot` is a copy (<home>/runtime/app-x with a source record), else null. */
export function copyHomeOf(packageRoot: string): string | null {
  const runtimeDir = path.dirname(packageRoot);
  if (path.basename(runtimeDir) !== 'runtime') return null;
  return fs.existsSync(path.join(runtimeDir, 'source')) ? path.dirname(runtimeDir) : null;
}

/**
 * The home of a copy, spelled as the user spells it. The package path is a real path, and the
 * registration holds the launcher path as setup spelled it (for example /var against /private/var).
 * When `gournalHome` is the same folder, use it.
 */
export function homeAsSpelled(copyHome: string, gournalHome: string): string {
  try {
    return fs.realpathSync(copyHome) === fs.realpathSync(gournalHome) ? gournalHome : copyHome;
  } catch {
    return copyHome;
  }
}
