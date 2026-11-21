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

export function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const FILES = ['source', 'anchor', 'rack'] as const;

export function sourceRecords(packageRoot: string, brew: HomebrewInstall | null): SourceRecords {
  if (brew) return { source: brew.source, anchor: `${brew.prefix}/Cellar`, rack: `${brew.prefix}/Cellar/gournal` };
  const source = fs.realpathSync(packageRoot);
  // A checkout's parent folder stays when the checkout goes, so its anchor is inside the source. Removing it gives "away".
  const installed = source.split(path.sep).includes('node_modules');
  return { source, anchor: installed ? path.dirname(source) : path.join(source, 'node_modules'), rack: source };
}

/** Returns true when a file changed. */
export function writeRecords(runtimeDir: string, records: SourceRecords): boolean {
  let wrote = false;
  for (const name of FILES) {
    const file = path.join(runtimeDir, name);
    const text = `${records[name]}\n`;
    if (readText(file) === text) continue;
    writeViaTemp(file, (tmp) => fs.writeFileSync(tmp, text));
    wrote = true;
  }
  return wrote;
}

/** Null when one record is missing or empty. */
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

/** The home of a copy when `packageRoot` is a copy (<home>/runtime/app-x with a source record), else null. */
export function copyHomeOf(packageRoot: string): string | null {
  const runtimeDir = path.dirname(packageRoot);
  if (path.basename(runtimeDir) !== 'runtime') return null;
  return fs.existsSync(path.join(runtimeDir, 'source')) ? path.dirname(runtimeDir) : null;
}
