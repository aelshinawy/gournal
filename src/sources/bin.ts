import fs from 'fs';
import path from 'path';

export interface ResolveBinOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Test seam. The default is true for a regular file. */
  exists?: (file: string) => boolean;
  /** Test seam. The default is process.cwd(). */
  cwd?: string;
}

const isFile = (file: string): boolean => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** The Windows environment ignores case, but a plain object does not. */
function windowsPath(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  return (key === undefined ? undefined : env[key]) ?? '';
}

/**
 * Scan the PATH folders of a Windows environment for one file, in order.
 * It skips empty entries, `.`, relative entries, and the current directory.
 * It returns the absolute path of the first regular file, or null.
 * Libuv and cmd.exe search the current directory before PATH. This scan never does.
 */
function scanWinPath(file: string, options: ResolveBinOptions): string | null {
  const win = path.win32;
  const env = options.env ?? process.env;
  const exists = options.exists ?? isFile;
  const cwd = win.resolve(options.cwd ?? process.cwd()).toLowerCase();
  for (const raw of windowsPath(env).split(';')) {
    const entry = raw.trim().replace(/^"(.*)"$/, '$1');
    if (entry === '' || entry === '.' || !win.isAbsolute(entry)) continue;
    if (win.resolve(entry).toLowerCase() === cwd) continue;
    const candidate = win.join(entry, file);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * The program to start for a bare name such as `git`.
 * On Windows, libuv looks in the current directory before PATH for a bare name. A cloned repo that
 * holds `git.exe` would run. So on Windows this scans PATH for `<name>.exe` and returns the absolute
 * path. It skips empty entries, relative entries, `.`, and the current directory.
 * It returns the bare name when it finds nothing, and on every other system.
 * A `.cmd` or `.bat` file is never a match: only a shell can start it. See resolveWinShim.
 */
export function resolveBin(name: string, options: ResolveBinOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return name;
  if (/[\\/]/.test(name)) return name;
  return scanWinPath(/\.exe$/i.test(name) ? name : `${name}.exe`, options) ?? name;
}

/**
 * The absolute path of the npm shim `<name>.cmd`, found in the PATH folders with the rules of resolveBin.
 * It returns null when there is no such file, for a name with a path separator, and on every other system.
 * Only a `.cmd` file counts. A `.bat` file never does.
 */
export function resolveWinShim(name: string, options: ResolveBinOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return null;
  if (/[\\/]/.test(name)) return null;
  return scanWinPath(`${name}.cmd`, options);
}
