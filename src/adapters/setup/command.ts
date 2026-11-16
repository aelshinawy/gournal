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
 * On Windows, always pin Node and the script path. A global npm install puts `gournal.cmd` and
 * `gournal.ps1` on PATH, not a file named `gournal`. A PATH probe cannot match them. A bare
 * `gournal` is a `.cmd` shim, which Claude Code cannot start without a shell.
 */
export function resolveGournalCommand(env: CommandEnv, platform: NodeJS.Platform = process.platform): GournalCommand {
  if (platform === 'win32') return { command: env.execPath, args: [env.argv1] };
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

/**
 * Quote one word for the manual `claude mcp add` line that setup prints.
 * POSIX shells get single quotes. On Windows, a word that needs quoting gets double quotes, which
 * PowerShell and cmd both accept.
 */
export function displayQuote(word: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return shellQuote(word);
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `"${word}"`;
}
