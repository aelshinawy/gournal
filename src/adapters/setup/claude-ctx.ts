import path from 'path';
import { shellQuote, displayQuote, type CommandEnv } from './command';
import type { StopHook } from './settings';
import type { CommandRunner } from './runner';
import { launcherCommand } from './launcher';
import { runtimePaths, type RuntimePaths } from './runtime';
import { isDefaultHome } from '../../storage';
import { SERVER } from './claude-files';

export interface SetupIo {
  out(t: string): void;
  err(t: string): void;
  /** The user's home. The `.claude` folder and `.claude.json` live in it. */
  home: string;
  /** The gournal home. The launcher and the runtime live in it. */
  gournalHome: string;
  isTTY: boolean;
  confirm(message: string, def: boolean): Promise<boolean>;
  exec: CommandRunner;
  env?: CommandEnv;
  /** Test seam. The default is process.platform. */
  platform?: NodeJS.Platform;
  packageRoot?: string;
  check?: CommandRunner;
  bakeHome?: boolean;
}

export interface SetupOptions {
  uninstall: boolean;
  yes: boolean;
  hook: boolean;
}

/** What the install and uninstall flows share. `status` is the exit code, and a flow raises it to 1. */
export interface Ctx {
  io: SetupIo;
  opts: SetupOptions;
  platform: NodeJS.Platform;
  env: CommandEnv;
  paths: RuntimePaths;
  bakeHome: boolean;
  claudeJson: string;
  skillFile: string;
  settingsFile: string;
  backupFile: string;
  prefix: { command: string; args: string[] };
  serverArgs: string[];
  addArgs: string[];
  removeArgs: string[];
  manualAdd: string;
  hook: StopHook;
  hookCommand: string;
  /** The hook text for a plan line. The exec form already holds its own quotes. */
  planCommand: string;
  status: number;
  shown(command: string, args: string[]): string;
  ask(message: string, def: boolean): Promise<boolean>;
  runClaude(args: string[]): Promise<'ok' | 'missing' | 'failed'>;
}

export function makeCtx(io: SetupIo, opts: SetupOptions): Ctx {
  const claudeDir = path.join(io.home, '.claude');
  const settingsFile = path.join(claudeDir, 'settings.json');
  const platform = io.platform ?? process.platform;
  const env = io.env ?? { execPath: process.execPath, cmdExe: path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') };
  const paths = runtimePaths(io.gournalHome, platform);
  const prefix = launcherCommand(paths.launcher, platform, env.cmdExe);
  const serverArgs = [...prefix.args, 'mcp'];
  // POSIX: one shell line. Windows: the exec form, because the hook shell there can be Git Bash or
  // PowerShell, and the two quote differently.
  const hookArgs = [...prefix.args, 'hook', 'stop'];
  const hook: StopHook = platform === 'win32'
    ? { command: prefix.command, args: hookArgs }
    : [prefix.command, ...hookArgs].map(shellQuote).join(' ');
  const shown = (command: string, args: string[]): string => [command, ...args].map((w) => displayQuote(w, platform)).join(' ');
  const hookCommand = typeof hook === 'string' ? hook : shown(hook.command, hook.args);
  const addArgs = ['mcp', 'add', '--scope', 'user', SERVER, '--', prefix.command, ...serverArgs];
  const ctx: Ctx = {
    io, opts, platform, env, paths,
    bakeHome: io.bakeHome ?? !isDefaultHome(io.gournalHome, platform),
    claudeJson: path.join(io.home, '.claude.json'),
    skillFile: path.join(claudeDir, 'skills', 'gournal', 'SKILL.md'),
    settingsFile,
    backupFile: `${settingsFile}.gournal-backup`,
    prefix, serverArgs, addArgs,
    removeArgs: ['mcp', 'remove', '--scope', 'user', SERVER],
    manualAdd: `claude ${shown(addArgs[0]!, addArgs.slice(1))}`,
    hook, hookCommand,
    planCommand: typeof hook === 'string' ? `"${hookCommand}"` : hookCommand,
    status: 0,
    shown,
    ask: (message, def) => (opts.yes ? Promise.resolve(true) : io.confirm(message, def)),
    runClaude: async (args) => {
      const r = await io.exec('claude', args);
      if (r.code === 0) return 'ok';
      if (r.code === 127) return 'missing';
      io.err(`claude ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
      return 'failed';
    },
  };
  return ctx;
}
