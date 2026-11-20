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

/** The last path part. It splits on both `/` and `\\`, so a Windows path works on any platform. */
export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? '';

/** How a registered command relates to the one setup writes now. */
export type RegistrationKind = 'current' | 'gournal' | 'foreign';

/**
 * Classify a registered MCP command. `gournal` means a form that gournal wrote in the past, or
 * a launcher at another path. Anything else is `foreign`, so setup never replaces a command it did not write.
 */
export function classifyRegistration(reg: GournalCommand, current: GournalCommand): RegistrationKind {
  if (reg.command === current.command && JSON.stringify(reg.args) === JSON.stringify(current.args)) return 'current';
  const { args } = reg;
  const cmd = baseName(reg.command);
  if (cmd === 'gournal') return args.length === 1 && args[0] === 'mcp' ? 'gournal' : 'foreign';
  const lower = cmd.toLowerCase();
  if (lower === 'node' || lower === 'node.exe') {
    const script = args.length === 2 ? baseName(args[0]!) : '';
    return (script === 'cli.js' || script === 'gournal') && args[1] === 'mcp' ? 'gournal' : 'foreign';
  }
  if (lower === 'cmd.exe') {
    const ok = args.length === 4 && args[0] === '/d' && args[1] === '/c' && baseName(args[2]!).toLowerCase() === 'gournal.cmd' && args[3] === 'mcp';
    return ok ? 'gournal' : 'foreign';
  }
  return 'foreign';
}
