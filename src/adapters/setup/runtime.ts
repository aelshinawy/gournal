import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensurePrivateDir, isDefaultHome, writeViaTemp } from '../../storage';
import { renderPosixLauncher } from './launcher';
import { renderWindowsLauncher } from './launcher-windows';
import { PACKAGE_ROOT, copyPackage, packageFingerprint } from './package-copy';

export interface RuntimePaths { home: string; binDir: string; launcher: string; runtimeDir: string; currentFile: string; nodeFile: string }
export type InstallAction = 'installed' | 'updated' | 'unchanged';

const COMPLETE = '.complete';

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

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Write a file when its content differs. Returns true when it wrote. */
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
  fs.rmSync(appDir, { recursive: true, force: true });
  const tmp = path.join(paths.runtimeDir, `.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    copyPackage(packageRoot, tmp);
    fs.writeFileSync(path.join(tmp, COMPLETE), '');
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

/** Remove old apps and temp folders. The new app and the previous app stay, because a running server may use the previous one. */
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
      fs.rmSync(path.join(runtimeDir, name), { recursive: true, force: true });
    } catch {
      // A folder that stays is removed by the next run.
    }
  }
}

export function installRuntime(o: { gournalHome: string; packageRoot: string; nodePath: string; platform: NodeJS.Platform; bakeHome: boolean }): { action: InstallAction; paths: RuntimePaths } {
  const paths = runtimePaths(o.gournalHome, o.platform);
  for (const dir of [paths.home, paths.binDir, paths.runtimeDir]) ensurePrivateDir(dir);
  const { version } = JSON.parse(fs.readFileSync(path.join(o.packageRoot, 'package.json'), 'utf8')) as { version: string };
  const appName = `app-${version}-${packageFingerprint(o.packageRoot)}`;
  const previousText = readText(paths.currentFile);
  const previous = previousText === null ? null : previousText.trim();

  let wrote = ensureApp(paths, appName, o.packageRoot);
  wrote = writeIfDiffers(paths.currentFile, `${appName}\n`) || wrote;
  wrote = writeIfDiffers(paths.nodeFile, `${o.nodePath}\n`) || wrote;
  const launcher = o.platform === 'win32'
    ? renderWindowsLauncher({ bakeHome: o.bakeHome })
    : renderPosixLauncher({ home: o.gournalHome, bakeHome: o.bakeHome });
  wrote = writeIfDiffers(paths.launcher, launcher, 0o700) || wrote;

  prune(paths.runtimeDir, new Set([appName, ...(previous ? [previous] : [])]));
  return { action: previousText === null ? 'installed' : wrote ? 'updated' : 'unchanged', paths };
}

/** Remove the launcher and the runtime. Other files in the home stay. */
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

function newer(a: string, b: string): boolean {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0);
  const y = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** Copy the installed package into the runtime when it is newer than the current app. Does nothing without a runtime. */
export function refreshRuntime(gournalHome: string, o: { packageRoot?: string; platform?: NodeJS.Platform } = {}): boolean {
  const platform = o.platform ?? process.platform;
  const packageRoot = o.packageRoot ?? PACKAGE_ROOT;
  const paths = runtimePaths(gournalHome, platform);
  const current = readText(paths.currentFile)?.trim();
  if (!current) return false;
  const have = (JSON.parse(fs.readFileSync(path.join(paths.runtimeDir, current, 'package.json'), 'utf8')) as { version: string }).version;
  const source = (JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version;
  if (!newer(source, have)) return false;
  const nodePath = (readText(paths.nodeFile) ?? '').trim();
  installRuntime({ gournalHome, packageRoot, nodePath, platform, bakeHome: !isDefaultHome(gournalHome) });
  return true;
}

/** The hook and the MCP server start often and must stay fast, so they never refresh. */
export function shouldRefresh(argv: string[]): boolean {
  return argv[2] !== 'mcp' && argv[2] !== 'hook';
}
