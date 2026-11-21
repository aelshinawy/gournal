import path from 'path';
import { shellQuote, displayQuote, type CommandEnv } from './command';
import type { StopHook } from './settings';
import type { CommandRunner } from './runner';
import { launcherCommand } from './launcher';
import { runtimePaths, type RuntimePaths } from './runtime';
import { isDefaultHome } from '../../storage';
import { SERVER } from './claude-files';
import { installFlow } from './install';
import { uninstallFlow } from './uninstall';

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
  /** Test seam. The default reads process.execPath and the Windows cmd.exe path. */
  env?: CommandEnv;
  /** Test seam. The default is process.platform. */
  platform?: NodeJS.Platform;
  /** Test seam. The default is the package that holds this code. */
  packageRoot?: string;
  /** Test seam. The default runs the launcher with a minimal environment. */
  check?: CommandRunner;
  /** Test seam. The default is true for a gournal home that is not the built-in one. */
  bakeHome?: boolean;
}

export interface SetupOptions {
  uninstall: boolean;
  yes: boolean;
  hook: boolean;
}

/** What the install and uninstall flows share. `status` is the exit code, and a flow raises it to 1. */
export interface SetupCtx {
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

function makeCtx(io: SetupIo, opts: SetupOptions): SetupCtx {
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
  const ctx: SetupCtx = {
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

function printPlan(ctx: SetupCtx): void {
  const { io, opts, paths } = ctx;
  io.out(`gournal setup claude would ${opts.uninstall ? 'remove' : 'make'} these changes:`);
  if (opts.uninstall) {
    io.out(`  1. Remove the MCP registration: claude ${ctx.removeArgs.join(' ')}`);
    io.out(`  2. Remove ${ctx.skillFile} (only if gournal wrote it)`);
    io.out(`  3. Remove the gournal Stop hook from ${ctx.settingsFile}`);
    io.out(`  4. Remove the launcher ${paths.launcher} and ${paths.runtimeDir}`);
  } else {
    io.out(`  1. Install the launcher ${paths.launcher} and a copy of gournal in ${paths.runtimeDir}`);
    io.out(`  2. Register the MCP server: ${ctx.manualAdd}`);
    io.out(`  3. Write the skill file ${ctx.skillFile}`);
    io.out(`  4. Optional, with --hook: add a Stop hook to ${ctx.settingsFile}: ${ctx.hookCommand}`);
  }
  io.err('Not a terminal. Run it again with --yes to apply these changes.');
}

export async function setupClaude(io: SetupIo, opts: SetupOptions): Promise<number> {
  const ctx = makeCtx(io, opts);
  if (!opts.yes && !io.isTTY) {
    printPlan(ctx);
    return 1;
  }
  if (opts.uninstall) await uninstallFlow(ctx);
  else await installFlow(ctx);
  return ctx.status;
}
