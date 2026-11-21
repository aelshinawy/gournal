import path from 'path';
import { resolveGournalCommand, shellQuote, displayQuote, type CommandEnv } from './command';
import type { StopHook } from './settings';
import type { CommandRunner } from './runner';
import { SERVER } from './claude-files';

export interface SetupIo {
  out(t: string): void;
  err(t: string): void;
  /** The user's home. Every path derives from it. */
  home: string;
  isTTY: boolean;
  confirm(message: string, def: boolean): Promise<boolean>;
  exec: CommandRunner;
  /** Test seam. The default reads process.argv, process.execPath and PATH. */
  env?: CommandEnv;
  /** Test seam. The default is process.platform. */
  platform?: NodeJS.Platform;
}

export interface SetupOptions { uninstall: boolean; yes: boolean; hook: boolean }

/** What every step shares. It is computed once per run. */
export interface Ctx {
  io: SetupIo;
  opts: SetupOptions;
  platform: NodeJS.Platform;
  claudeJson: string;
  skillFile: string;
  settingsFile: string;
  backupFile: string;
  cmd: { command: string; args: string[] };
  serverArgs: string[];
  hook: StopHook;
  hookCommand: string;
  addArgs: string[];
  removeArgs: string[];
  manualAdd: string;
}

export const shown = (platform: NodeJS.Platform, command: string, args: string[]): string =>
  [command, ...args].map((w) => displayQuote(w, platform)).join(' ');

export function makeCtx(io: SetupIo, opts: SetupOptions): Ctx {
  const claudeDir = path.join(io.home, '.claude');
  const settingsFile = path.join(claudeDir, 'settings.json');
  const env = io.env ?? { argv1: process.argv[1] ?? '', execPath: process.execPath, path: process.env.PATH ?? '' };
  const platform = io.platform ?? process.platform;
  const cmd = resolveGournalCommand(env, platform);
  const serverArgs = [...cmd.args, 'mcp'];
  // POSIX: one shell line. Windows: the exec form, because the hook shell there can be Git Bash or
  // PowerShell, and the two quote differently.
  const hookArgs = [...cmd.args, 'hook', 'stop'];
  const hook: StopHook = platform === 'win32'
    ? { command: cmd.command, args: hookArgs }
    : [cmd.command, ...hookArgs].map(shellQuote).join(' ');
  const addArgs = ['mcp', 'add', '--scope', 'user', SERVER, '--', cmd.command, ...serverArgs];
  return {
    io, opts, platform, cmd, serverArgs, hook, addArgs, settingsFile,
    claudeJson: path.join(io.home, '.claude.json'),
    skillFile: path.join(claudeDir, 'skills', 'gournal', 'SKILL.md'),
    backupFile: `${settingsFile}.gournal-backup`,
    hookCommand: typeof hook === 'string' ? hook : shown(platform, hook.command, hook.args),
    removeArgs: ['mcp', 'remove', '--scope', 'user', SERVER],
    manualAdd: `claude ${shown(platform, addArgs[0]!, addArgs.slice(1))}`,
  };
}

/** --yes answers every prompt with yes. */
export const ask = (c: Ctx, message: string, def: boolean): Promise<boolean> =>
  (c.opts.yes ? Promise.resolve(true) : c.io.confirm(message, def));

/** The hook text for a plan line. The exec form already holds its own quotes. Do not wrap it in a second pair. */
export const planCommand = (c: Ctx): string => (typeof c.hook === 'string' ? `"${c.hookCommand}"` : c.hookCommand);
