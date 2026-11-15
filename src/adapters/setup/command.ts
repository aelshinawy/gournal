import fs from 'fs';
import path from 'path';

export interface CommandEnv { argv1: string; execPath: string; path: string }
export interface GournalCommand { command: string; args: string[] }

function real(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

/**
 * Pick the command that starts this gournal. Use bare `gournal` when `gournal` on PATH is the same
 * script as the one that runs now. Otherwise pin Node and the script path.
 */
export function resolveGournalCommand(env: CommandEnv): GournalCommand {
  const self = real(env.argv1);
  if (self !== null) {
    for (const dir of env.path.split(path.delimiter).filter(Boolean)) {
      const found = real(path.join(dir, 'gournal'));
      if (found !== null && found === self) return { command: 'gournal', args: [] };
    }
  }
  return { command: env.execPath, args: [env.argv1] };
}

/** Quote one shell word when it holds characters that a shell would split or expand. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}
