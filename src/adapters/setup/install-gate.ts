import fs from 'fs';
import path from 'path';
import { writeViaTemp } from '../../storage';
import { runtimePaths } from './runtime';
import { copyHomeOf, readRecords, uninstallVerdict } from './source';

/**
 * After a package removal, the MCP server runs from the copy for this many seconds. P18 measured the
 * gap of a package replacement ("npm install --global" of a new version) as about 215 ms, with the
 * package folder missing the whole time. The grace is far longer than the gap.
 */
const MCP_GRACE_S = 60;

export type GateResult =
  | { kind: 'run'; notice?: string }
  | { kind: 'exit'; code: number; message: string };

export interface GateOptions {
  argv: string[];
  packageRoot: string;
  gournalHome: string;
  now: Date;
  platform: NodeJS.Platform;
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
  const records = readRecords(path.join(realHome, 'runtime'));
  if (records === null) return { kind: 'run' };
  if (uninstallVerdict(records, fs.existsSync) !== 'uninstalled') {
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
  // Only the Stop hook is silent. A future hook command gets the normal rules.
  if (command === 'hook' && o.argv[3] === 'stop') return { kind: 'run' };
  if (command === 'setup' && o.argv.includes('--uninstall')) return { kind: 'run' };
  if (age < MCP_GRACE_S) {
    return { kind: 'run', notice: `gournal: the installed package ${records.source} is missing. gournal runs from its copy in ${realHome}/runtime.` };
  }
  const launcher = runtimePaths(realHome, o.platform).launcher;
  return { kind: 'exit', code: 1, message: `gournal: gournal is no longer installed: ${records.source} is gone. To remove gournal from Claude Code, run: ${launcher} setup claude --uninstall` };
}
