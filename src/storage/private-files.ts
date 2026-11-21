import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isDefaultHome } from './home';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Mode changes are best effort. These codes mean the change cannot or need not happen:
 * no mode support (ENOTSUP, EINVAL), another owner (EPERM), a read-only file system (EROFS),
 * or a file that another process removed (ENOENT). Any other code is a real fault.
 */
const CHMOD_IGNORED = new Set(['ENOTSUP', 'EPERM', 'EINVAL', 'EROFS', 'ENOENT']);
/** Same as above, except ENOENT: a missing folder is a real fault. EROFS is ignored so SQLite can report it. */
const CREATE_IGNORED = new Set(['ENOTSUP', 'EPERM', 'EINVAL', 'EROFS']);
const hasCode = (err: unknown, codes: Set<string>): boolean => codes.has((err as NodeJS.ErrnoException).code ?? '');

function bestEffortChmod(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch (err) {
    if (!hasCode(err, CHMOD_IGNORED)) throw err;
  }
}

/**
 * Create a directory with mode 0700. In the default home, also tighten an existing directory.
 * A custom home is created with 0700 when it is new, and never changed when it exists.
 */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  if (isDefaultHome(path.dirname(dir)) || isDefaultHome(dir)) bestEffortChmod(dir, DIR_MODE);
}

/**
 * Create an empty file with mode 0600 if it does not exist. SQLite gives the WAL and SHM files
 * the mode of the database file, so a private database file makes all three private.
 * In the default home, also tighten an existing file and its WAL and SHM files.
 */
export function ensurePrivateFile(file: string): void {
  try {
    fs.closeSync(fs.openSync(file, 'wx', FILE_MODE));
  } catch (err) {
    // SQLite can still create the file later on such a file system.
    if (hasCode(err, CREATE_IGNORED)) return;
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  tightenFile(file);
}

/** Tighten one existing file, only when it lives in the default home or directly in its backups folder. */
export function tightenFile(file: string): void {
  const dir = path.dirname(file);
  if (isDefaultHome(dir) || (path.basename(dir) === 'backups' && isDefaultHome(path.dirname(dir)))) {
    bestEffortChmod(file, FILE_MODE);
  }
}

/** Tighten the database file and its WAL and SHM files. Default home only. */
export function tightenDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) tightenFile(f);
  }
}

/** Tighten the backups folder and every file in it. Default home only. */
export function tightenBackups(home: string): void {
  if (!isDefaultHome(home)) return;
  const dir = path.join(home, 'backups');
  try {
    if (!fs.statSync(dir).isDirectory()) return;
  } catch {
    return;
  }
  bestEffortChmod(dir, DIR_MODE);
  try {
    for (const name of fs.readdirSync(dir)) tightenFile(path.join(dir, name));
  } catch { /* the folder cannot be listed */ }
}

/**
 * Reserve an empty temp file next to target and return its path. The mode is 0600 unless given.
 * The name has a random suffix and the open uses "wx", so an attacker cannot predict it or plant a symlink there.
 */
function createPrivateTemp(target: string, mode = FILE_MODE): string {
  const dir = path.dirname(path.resolve(target));
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.closeSync(fs.openSync(tmp, 'wx', mode));
  return tmp;
}

/** Windows can refuse a rename for a short time: a virus scanner or an indexer holds a file. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY']);
const RENAME_ATTEMPTS = 3;
const RENAME_DELAY_MS = 50;

/** Block the thread. Atomics.wait needs no dependency. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface RenameDeps {
  /** Test seam. The default is process.platform. */
  platform?: NodeJS.Platform;
  /** Test seam. The default is fs.renameSync. */
  rename?: (from: string, to: string) => void;
  /** Test seam. The default blocks the thread. */
  sleep?: (ms: number) => void;
}

/** Rename a temp file onto its final path. Only on Windows, and only for EPERM or EBUSY, retry up to 3 times. */
export function renameWithRetry(from: string, to: string, deps: RenameDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  const rename = deps.rename ?? ((a: string, b: string) => fs.renameSync(a, b));
  const sleep = deps.sleep ?? sleepSync;
  const attempts = platform === 'win32' ? RENAME_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      if (attempt >= attempts || !hasCode(err, RENAME_RETRY_CODES)) throw err;
      sleep(RENAME_DELAY_MS);
    }
  }
}

/**
 * Publish a finished temp file at target, and never replace an existing target: it throws EEXIST.
 * It returns 'link' for a hard link, or 'rename' on a file system without hard links.
 * The fallback first claims the target with an exclusive create, which is atomic. Only the winner
 * of the claim renames, so a loser never overwrites the winner.
 */
export function publishExclusive(tmp: string, target: string, deps: RenameDeps = {}): 'link' | 'rename' {
  try {
    // link() is atomic. It fails with EEXIST even if another process made the target a moment ago.
    fs.linkSync(tmp, target);
    return 'link';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw err;
    // No hard links on this file system. Fall back to claim and rename.
  }
  fs.closeSync(fs.openSync(target, 'wx', FILE_MODE));
  try {
    renameWithRetry(tmp, target, deps);
  } catch (err) {
    // Remove the empty claim, so it does not block the next run.
    fs.rmSync(target, { force: true });
    throw err;
  }
  return 'rename';
}

export interface WriteViaTempOptions<T> {
  /** Mode for the new temp file. The umask applies. Default FILE_MODE (0600). */
  mode?: number;
  /** Publish the filled temp at target. Default: renameWithRetry(tmp, target, rename). */
  publish?: (tmp: string, target: string) => T;
  /** Test seam for the default publish (platform, rename, sleep). */
  rename?: RenameDeps;
}

/** Write a file by temp file and publish, so a reader never sees a partial file. The temp file is always removed. */
export function writeViaTemp<T = void>(target: string, fill: (tmp: string) => void, opts: WriteViaTempOptions<T> = {}): T {
  const tmp = createPrivateTemp(target, opts.mode);
  try {
    fill(tmp);
    if (opts.publish) return opts.publish(tmp, target);
    renameWithRetry(tmp, target, opts.rename);
    return undefined as T;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Write a 0600 file through writeViaTemp. With exclusive set, an existing target throws EEXIST. */
export function writePrivateFile(target: string, data: string, opts: { exclusive?: boolean } = {}): void {
  writeViaTemp(target, (tmp) => fs.writeFileSync(tmp, data), opts.exclusive ? { publish: (from, to) => void publishExclusive(from, to) } : {});
}

/** Check that the folder of an output file exists and is a folder. It throws a plain message for each refusal. */
function assertTargetDir(target: string): void {
  const dir = path.dirname(path.resolve(target));
  let dirStat: fs.Stats | undefined;
  try {
    dirStat = fs.statSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`directory does not exist: ${dir}`);
    throw err;
  }
  if (!dirStat.isDirectory()) throw new Error(`not a directory: ${dir}`);
}

/**
 * Check an export target before any work. It throws a plain message for each refusal.
 * The target must not be a symlink. It must not exist unless force is set. Its folder must exist.
 */
export function assertExportTarget(target: string, force: boolean): void {
  assertTargetDir(target);

  let st: fs.Stats | undefined;
  try {
    st = fs.lstatSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (st.isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${target}`);
  if (!st.isFile()) throw new Error(`not a regular file: ${target}`);
  if (!force) throw new Error(`${target} already exists. Use --force to overwrite it.`);
}

/** Write an export file. Refuses a symlink, refuses overwrite without force, creates mode 0600. */
export function writeExportFile(target: string, data: string, force: boolean): void {
  assertExportTarget(target, force);
  try {
    writePrivateFile(target, data, { exclusive: !force });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${target} already exists. Use --force to overwrite it.`);
    throw err;
  }
}
