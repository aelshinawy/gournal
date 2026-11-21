import fs from 'fs';
import path from 'path';
import { writeViaTemp } from '../../storage';
import { runtimePaths } from './runtime';
import { detectHomebrew } from './homebrew';
import { copyHomeOf, findOtherInstall, homeAsSpelled, readRecords, sourceRecords, uninstallVerdict, writeRecords } from './source';

/**
 * After a package removal, the MCP server runs from the copy for this many seconds. P18 measured the
 * gap of a package replacement ("npm install --global" of a new version) as about 215 ms, with the
 * package folder missing the whole time. The grace is far longer than the gap.
 */
export const MCP_GRACE_S = 60;
/** The Stop hook removes the gournal setup when the "uninstalled" verdict is this old. */
export const CLEANUP_AFTER_S = 3600;

export type GateResult =
  | { kind: 'run'; notice?: string }
  | { kind: 'exit'; code: number; message: string }
  | { kind: 'cleanup' };

export interface GateOptions {
  argv: string[];
  packageRoot: string;
  gournalHome: string;
  userHome: string;
  now: Date;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** Test seam for the search of another install. */
  find?: { exists(p: string): boolean; readdir(p: string): string[] };
}

/** Any clock value before September 2001 is not a real removal time. */
const MIN_EPOCH_S = 1_000_000_000;

/** The marker value, or null when the file is missing or holds anything but whole seconds from MIN_EPOCH_S to nowS. */
function readSeconds(file: string, nowS: number): number | null {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return n >= MIN_EPOCH_S && n <= nowS ? n : null;
  } catch {
    return null;
  }
}

const dropMarker = (file: string): void => fs.rmSync(file, { force: true });

/**
 * Decide what a command does when the installed package is gone. Called before every command.
 * Outside the copy it only removes a stale marker.
 */
export function installGate(o: GateOptions): GateResult {
  const realHome = copyHomeOf(o.packageRoot);
  const marker = path.join(realHome ?? o.gournalHome, 'runtime', 'removed-at');
  if (realHome === null) {
    if (fs.existsSync(marker)) dropMarker(marker);
    return { kind: 'run' };
  }
  const copyHome = homeAsSpelled(realHome, o.gournalHome);
  const runtimeDir = path.join(copyHome, 'runtime');
  const records = readRecords(runtimeDir);
  if (records === null) return { kind: 'run' };
  const exists = o.find?.exists ?? fs.existsSync;
  if (uninstallVerdict(records, exists) !== 'uninstalled') {
    dropMarker(marker);
    return { kind: 'run' };
  }
  const other = findOtherInstall({ userHome: o.userHome, env: o.env, platform: o.platform, exists: o.find?.exists, readdir: o.find?.readdir });
  if (other !== null) {
    writeRecords(runtimeDir, sourceRecords(other, detectHomebrew(other, o.platform)));
    dropMarker(marker);
    return { kind: 'run' };
  }
  const nowS = Math.floor(o.now.getTime() / 1000);
  let since = readSeconds(marker, nowS);
  if (since === null) {
    // A missing, corrupt, zero, negative, or future marker starts the clock now.
    since = nowS;
    writeViaTemp(marker, (tmp) => fs.writeFileSync(tmp, `${nowS}\n`));
  }
  const age = nowS - since;
  const command = o.argv[2];
  // Only the Stop hook is silent and cleans up. A future hook command gets the normal rules.
  if (command === 'hook' && o.argv[3] === 'stop') return age < CLEANUP_AFTER_S ? { kind: 'run' } : { kind: 'cleanup' };
  if (command === 'setup' && o.argv.includes('--uninstall')) return { kind: 'run' };
  if (age < MCP_GRACE_S) {
    return { kind: 'run', notice: `gournal: the installed package ${records.source} is missing. gournal runs from its copy in ${copyHome}/runtime.` };
  }
  const launcher = runtimePaths(copyHome, o.platform).launcher;
  return { kind: 'exit', code: 1, message: `gournal: gournal is no longer installed: ${records.source} is gone. To remove gournal from Claude Code, run: ${launcher} setup claude --uninstall` };
}
