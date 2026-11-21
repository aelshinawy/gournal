import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensurePrivateDir, writeViaTemp } from '../../storage';
import { renderPosixLauncher } from './launcher';
import { renderWindowsLauncher } from './launcher-windows';
import { PACKAGE_ROOT, copyPackage, packageFingerprint } from './package-copy';
import { detectHomebrew } from './homebrew';
import { readText, sourceRecords, writeRecords, type SourceRecords } from './source';

export interface RuntimePaths { home: string; binDir: string; launcher: string; runtimeDir: string; currentFile: string; nodeFile: string }
export type InstallAction = 'installed' | 'updated' | 'unchanged';

const COMPLETE = '.complete';
/** A temp folder younger than this may belong to a setup or a refresh that runs now. */
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

export function runtimePaths(gournalHome: string, platform: NodeJS.Platform): RuntimePaths {
  const binDir = path.join(gournalHome, 'bin');
  const runtimeDir = path.join(gournalHome, 'runtime');
  return {
    home: gournalHome,
    binDir,
    launcher: path.join(binDir, platform === 'win32' ? 'gournal.cmd' : 'gournal'),
    runtimeDir,
    currentFile: path.join(runtimeDir, 'current'),
    nodeFile: path.join(runtimeDir, 'node'),
  };
}

function writeIfDiffers(file: string, content: string, mode?: number): boolean {
  if (readText(file) === content) return false;
  writeViaTemp(file, (tmp) => fs.writeFileSync(tmp, content), { mode });
  if (mode !== undefined) fs.chmodSync(file, mode);
  return true;
}

/** Make the app folder. It is complete only when it holds the marker. A folder without it is never reused. */
function ensureApp(paths: RuntimePaths, appName: string, packageRoot: string): boolean {
  const appDir = path.join(paths.runtimeDir, appName);
  if (fs.existsSync(path.join(appDir, COMPLETE))) return false;
  const tmp = path.join(paths.runtimeDir, `.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    copyPackage(packageRoot, tmp);
    fs.writeFileSync(path.join(tmp, COMPLETE), '');
    // Check again after the slow copy. Another process may have finished this app, and a finished app may be in use.
    if (fs.existsSync(path.join(appDir, COMPLETE))) return false;
    fs.rmSync(appDir, { recursive: true, force: true });
    try {
      fs.renameSync(tmp, appDir);
    } catch (err) {
      // Another process won the race with the same app. Its folder is complete, so use it.
      if (!fs.existsSync(path.join(appDir, COMPLETE))) throw err;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return true;
}

/**
 * Remove old apps and old temp folders. The new app and the previous app stay, because a running server may use the previous one.
 * A temp folder that is younger than one hour stays, because another process may fill it now.
 */
function prune(runtimeDir: string, keep: Set<string>): void {
  let names: string[];
  try {
    names = fs.readdirSync(runtimeDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (keep.has(name) || !(name.startsWith('app-') || name.startsWith('.tmp-'))) continue;
    try {
      if (name.startsWith('.tmp-') && Date.now() - fs.statSync(path.join(runtimeDir, name)).mtimeMs < TMP_MAX_AGE_MS) continue;
      fs.rmSync(path.join(runtimeDir, name), { recursive: true, force: true });
    } catch {
      // A folder that stays is removed by the next run.
    }
  }
}

export function installRuntime(o: {
  gournalHome: string;
  packageRoot: string;
  nodePath: string;
  platform: NodeJS.Platform;
  bakeHome: boolean;
  records?: SourceRecords;
}): { action: InstallAction; paths: RuntimePaths } {
  const paths = runtimePaths(o.gournalHome, o.platform);
  for (const dir of [paths.home, paths.binDir, paths.runtimeDir]) ensurePrivateDir(dir);
  const { version } = JSON.parse(fs.readFileSync(path.join(o.packageRoot, 'package.json'), 'utf8')) as { version: string };
  const appName = `app-${version}-${packageFingerprint(o.packageRoot)}`;
  const previousText = readText(paths.currentFile);
  const previous = previousText === null ? null : previousText.trim();

  let wrote = ensureApp(paths, appName, o.packageRoot);
  wrote = writeIfDiffers(paths.currentFile, `${appName}\n`) || wrote;
  wrote = writeIfDiffers(paths.nodeFile, `${o.nodePath}\n`) || wrote;
  wrote = writeRecords(paths.runtimeDir, o.records ?? sourceRecords(o.packageRoot, detectHomebrew(o.packageRoot, o.platform))) || wrote;
  const launcher = o.platform === 'win32'
    ? renderWindowsLauncher({ bakeHome: o.bakeHome })
    : renderPosixLauncher({ home: o.gournalHome, bakeHome: o.bakeHome });
  wrote = writeIfDiffers(paths.launcher, launcher, 0o700) || wrote;

  prune(paths.runtimeDir, new Set([appName, ...(previous ? [previous] : [])]));
  return { action: previousText === null ? 'installed' : wrote ? 'updated' : 'unchanged', paths };
}

export function removeRuntime(gournalHome: string, platform: NodeJS.Platform): boolean {
  const paths = runtimePaths(gournalHome, platform);
  let removed = false;
  for (const file of [path.join(paths.binDir, 'gournal'), path.join(paths.binDir, 'gournal.cmd')]) {
    if (fs.existsSync(file)) { fs.rmSync(file, { force: true }); removed = true; }
  }
  if (fs.existsSync(paths.runtimeDir)) { fs.rmSync(paths.runtimeDir, { recursive: true, force: true }); removed = true; }
  try {
    if (fs.readdirSync(paths.binDir).length === 0) { fs.rmdirSync(paths.binDir); removed = true; }
  } catch {
    // No bin folder.
  }
  return removed;
}

/**
 * When the recorded source is gone and this run is an installed package, record this package as the source.
 * A reinstall under another Node.js version then counts as installed.
 */
export function adoptInstalledPackage(gournalHome: string, o: { packageRoot?: string; platform?: NodeJS.Platform } = {}): void {
  const packageRoot = o.packageRoot ?? PACKAGE_ROOT;
  const platform = o.platform ?? process.platform;
  const { runtimeDir } = runtimePaths(gournalHome, platform);
  const recorded = readText(path.join(runtimeDir, 'source'))?.trim();
  if (!recorded || fs.existsSync(path.join(recorded, 'dist', 'cli.js'))) return;
  if (!fs.realpathSync(packageRoot).split(path.sep).includes('node_modules')) return;
  writeRecords(runtimeDir, sourceRecords(packageRoot, detectHomebrew(packageRoot, platform)));
}
