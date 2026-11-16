import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { newId } from '../../core';
import { resolveBin, resolveWinShim } from '../../sources';
import { renameWithRetry } from '../../storage';
import { resolveGournalCommand, shellQuote, displayQuote, type CommandEnv } from './command';
import { SKILL_MARKER, SKILL_MD } from './skill';
import { addStopHook, removeStopHook, type StopHook } from './settings';

/** ENOENT (the binary is missing) maps to code 127. */
export type CommandRunner = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

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

export interface ExecOptions { windowsHide: true; windowsVerbatimArguments?: true; env?: NodeJS.ProcessEnv }
type RunResult = Awaited<ReturnType<CommandRunner>>;
/** One process start, with no retry. ENOENT maps to code 127. */
export type ExecOnce = (file: string, args: string[], options: ExecOptions) => Promise<RunResult>;

/** Production: execFile, no shell. Never throws. */
export const execOnce: ExecOnce = (file, args, options) =>
  new Promise((resolve) => {
    const done = (error: Error | null, stdout: string, stderr: string): void => {
      if (error === null) return resolve({ code: 0, stdout, stderr });
      const e = error as NodeJS.ErrnoException & { code?: string | number };
      if (e.code === 'ENOENT') return resolve({ code: 127, stdout, stderr: e.message });
      resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout, stderr: stderr || e.message });
    };
    try {
      execFile(file, args, { encoding: 'utf8', timeout: 60_000, ...options }, done);
    } catch (error) {
      // Node throws at once for a file that it will not start, such as a .cmd without a shell.
      done(error as Error, '', '');
    }
  });

/**
 * Characters that cmd.exe would act on, even inside double quotes, or that cannot be quoted.
 * The `!` is here because delayed expansion, when the registry turns it on, expands `!var!` in quotes.
 */
const CMD_UNSAFE = /[%^&|<>!"\r\n\0]/;

/**
 * Build the command line for `cmd.exe /d /s /c`: the absolute path of the program, then every
 * argument, each in double quotes. Throw for a path or an argument that cannot be quoted safely.
 * A Windows path never holds a double quote, so setup does not escape one. It rejects the value instead.
 * The caller puts one more pair of quotes around the whole line. See createExecFileRunner.
 */
export function buildCmdLine(program: string, args: string[]): string {
  if (CMD_UNSAFE.test(program)) {
    throw new Error(`cannot run "${program}" through cmd.exe: the path holds one of % ^ & | < > ! " or a line break. Run the claude mcp add command yourself.`);
  }
  const quoted = args.map((a) => {
    if (CMD_UNSAFE.test(a)) {
      throw new Error(`cannot pass the argument "${a}" through cmd.exe: it holds one of % ^ & | < > ! " or a line break. Run the claude mcp add command yourself.`);
    }
    // A backslash run before the closing quote would escape it. Double the run.
    return `"${a.replace(/\\+$/, (run) => run + run)}"`;
  });
  return [`"${program}"`, ...quoted].join(' ');
}

export interface RunnerDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  once?: ExecOnce;
  exists?: (file: string) => boolean;
  /** Test seam. The default is process.cwd(). */
  cwd?: string;
  /** Test seam. The default is resolveWinShim with the platform, env, cwd, and exists of these deps. */
  resolveShim?: (name: string) => string | null;
}

/**
 * Make the production runner. On Windows an npm install of `claude` is a `claude.cmd` shim.
 * `execFile` cannot find it and gives ENOENT. The runner then looks for the shim in the absolute
 * folders of PATH. It never uses the current folder, because cmd.exe would run a `claude.bat` there.
 * If it finds a shim, it runs the shim through cmd.exe, once. If not, the code is 127 and no
 * cmd.exe starts. There is never a shell option with an args array.
 */
export function createExecFileRunner(deps: RunnerDeps = {}): CommandRunner {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const once = deps.once ?? execOnce;
  const binOptions = { platform, env, exists: deps.exists, cwd: deps.cwd };
  const resolveShim = deps.resolveShim ?? ((name: string) => resolveWinShim(name, binOptions));
  return async (file, args) => {
    // On Windows the first try uses the full path to claude.exe, so the current directory is never searched.
    const first = await once(resolveBin(file, binOptions), args, { windowsHide: true });
    if (platform !== 'win32' || first.code !== 127) return first;
    const shim = resolveShim(file);
    if (shim === null) return first;
    let cmdline: string;
    try {
      cmdline = buildCmdLine(shim, args);
    } catch (error) {
      return { code: 1, stdout: '', stderr: (error as Error).message };
    }
    // With /s, cmd.exe removes the first and the last quote of the command. The outer pair is for that.
    // NoDefaultCurrentDirectoryInExePath is a second layer: cmd.exe then skips the current folder.
    const comspec = env.ComSpec ?? path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'cmd.exe');
    return once(comspec, ['/d', '/s', '/c', `"${cmdline}"`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
      env: { ...env, NoDefaultCurrentDirectoryInExePath: '1' },
    });
  };
}

export const execFileRunner: CommandRunner = createExecFileRunner();

type Json = Record<string, unknown>;
const SERVER = 'gournal';

/**
 * Write through a symlink: the temp file goes next to the real target, so the link stays a link.
 * An existing file keeps its mode. Windows has no mode bits to keep, and a read-only copy would
 * block the rename, so it skips the copy.
 */
function writeAtomic(file: string, content: string, platform: NodeJS.Platform): void {
  const real = fs.existsSync(file) ? fs.realpathSync(file) : file;
  fs.mkdirSync(path.dirname(real), { recursive: true });
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.${process.pid}.${newId()}.tmp`);
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    if (platform !== 'win32' && fs.existsSync(real)) fs.chmodSync(tmp, fs.statSync(real).mode & 0o7777);
    renameWithRetry(tmp, real, { platform });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

type SettingsRead = { kind: 'ok'; settings: Json; exists: boolean } | { kind: 'invalid' };

function readSettings(file: string): SettingsRead {
  if (!fs.existsSync(file)) return { kind: 'ok', settings: {}, exists: false };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { kind: 'ok', settings: parsed as Json, exists: true };
    }
  } catch { /* fall through */ }
  return { kind: 'invalid' };
}

function readRegistration(claudeJson: string): { command: string; args: string[] } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(claudeJson, 'utf8')) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
    const s = parsed.mcpServers?.[SERVER];
    if (!s) return null;
    return {
      command: typeof s.command === 'string' ? s.command : '',
      args: Array.isArray(s.args) ? s.args.map(String) : [],
    };
  } catch {
    return null;
  }
}


export async function setupClaude(io: SetupIo, opts: SetupOptions): Promise<number> {
  const claudeDir = path.join(io.home, '.claude');
  const claudeJson = path.join(io.home, '.claude.json');
  const skillFile = path.join(claudeDir, 'skills', 'gournal', 'SKILL.md');
  const settingsFile = path.join(claudeDir, 'settings.json');
  const env = io.env ?? { argv1: process.argv[1] ?? '', execPath: process.execPath, path: process.env.PATH ?? '' };
  const platform = io.platform ?? process.platform;
  const shown = (command: string, args: string[]): string => [command, ...args].map((w) => displayQuote(w, platform)).join(' ');
  const cmd = resolveGournalCommand(env, platform);
  const serverArgs = [...cmd.args, 'mcp'];
  // POSIX: one shell line. Windows: the exec form, because the hook shell there can be Git Bash or
  // PowerShell, and the two quote differently.
  const hookArgs = [...cmd.args, 'hook', 'stop'];
  const hook: StopHook = platform === 'win32'
    ? { command: cmd.command, args: hookArgs }
    : [cmd.command, ...hookArgs].map(shellQuote).join(' ');
  const hookCommand = typeof hook === 'string' ? hook : shown(hook.command, hook.args);
  // The exec form already holds its own quotes. Do not wrap it in a second pair.
  const planCommand = typeof hook === 'string' ? `"${hookCommand}"` : hookCommand;
  const addArgs = ['mcp', 'add', '--scope', 'user', SERVER, '--', cmd.command, ...serverArgs];
  const backupFile = `${settingsFile}.gournal-backup`;
  const removeArgs = ['mcp', 'remove', '--scope', 'user', SERVER];
  const manualAdd = `claude ${shown(addArgs[0]!, addArgs.slice(1))}`;
  let status = 0;

  const ask = (message: string, def: boolean): Promise<boolean> => (opts.yes ? Promise.resolve(true) : io.confirm(message, def));

  if (!opts.yes && !io.isTTY) {
    const verb = opts.uninstall ? 'remove' : 'make';
    io.out(`gournal setup claude would ${verb} these changes:`);
    if (opts.uninstall) {
      io.out(`  1. Remove the MCP registration: claude ${removeArgs.join(' ')}`);
      io.out(`  2. Remove ${skillFile} (only if gournal wrote it)`);
      io.out(`  3. Remove the gournal Stop hook from ${settingsFile}`);
    } else {
      io.out(`  1. Register the MCP server: ${manualAdd}`);
      io.out(`  2. Write the skill file ${skillFile}`);
      io.out(`  3. Optional, with --hook: add a Stop hook to ${settingsFile}: ${hookCommand}`);
    }
    io.err('Not a terminal. Run it again with --yes to apply these changes.');
    return 1;
  }

  const runClaude = async (args: string[]): Promise<'ok' | 'missing' | 'failed'> => {
    const r = await io.exec('claude', args);
    if (r.code === 0) return 'ok';
    if (r.code === 127) return 'missing';
    io.err(`claude ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
    return 'failed';
  };

  const registerMcp = async (): Promise<'ok' | 'missing' | 'failed'> => {
    const res = await runClaude(addArgs);
    if (res === 'ok') io.out('MCP server: registered.');
    else if (res === 'missing') {
      io.out('MCP server: the claude CLI was not found on PATH. Run this command yourself:');
      io.out(`  ${manualAdd}`);
      status = 1; // Nothing is registered. Do not exit 0.
    } else {
      // On Windows the failure can be an argument that cmd.exe cannot quote. Print the line to run by hand.
      if (platform === 'win32') io.out(`MCP server: could not register. Run this command yourself:\n  ${manualAdd}`);
      status = 1;
    }
    return res;
  };

  const writeSettings = (read: Extract<SettingsRead, { kind: 'ok' }>, next: Json, takeBackup: boolean): void => {
    // Keep the first backup: it holds the file as it was before gournal. Only install takes it.
    if (takeBackup && read.exists && !fs.existsSync(backupFile)) fs.copyFileSync(settingsFile, backupFile);
    writeAtomic(settingsFile, JSON.stringify(next, null, 2) + '\n', platform);
  };

  if (!opts.uninstall) {
    // 1. MCP registration
    const reg = readRegistration(claudeJson);
    if (reg === null) {
      io.out(`MCP server: register gournal for all projects (${manualAdd}).`);
      if (await ask('Register the gournal MCP server with Claude Code?', true)) await registerMcp();
      else io.out('MCP server: skipped.');
    } else if (reg.command === cmd.command && JSON.stringify(reg.args) === JSON.stringify(serverArgs)) {
      io.out('MCP server: already set up.');
    } else {
      io.out(`MCP server: gournal is registered as "${shown(reg.command, reg.args)}". Setup would use "${shown(cmd.command, serverArgs)}".`);
      if (!io.isTTY) {
        io.out('MCP server: kept the existing registration. Run setup in a terminal to replace it.');
      } else if (await io.confirm('Replace the existing gournal MCP registration?', false)) {
        const removed = await runClaude(removeArgs);
        if (removed === 'ok') {
          if ((await registerMcp()) === 'failed') {
            io.out('MCP server: the old registration was removed. To restore it, run:');
            io.out(`  claude mcp add --scope user ${SERVER} -- ${shown(reg.command, reg.args)}`);
          }
        } else if (removed === 'missing') {
          io.out('MCP server: the claude CLI was not found on PATH. Run these yourself:');
          io.out(`  claude ${removeArgs.join(' ')}`);
          io.out(`  ${manualAdd}`);
          status = 1;
        } else status = 1;
      } else io.out('MCP server: kept the existing registration.');
    }

    // 2. Skill file
    const current = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, 'utf8') : null;
    if (current === SKILL_MD) io.out('Skill: already set up.');
    else if (current !== null && !current.includes(SKILL_MARKER)) {
      io.out(`Skill: ${skillFile} exists and gournal did not write it. Left alone.`);
    } else {
      io.out(`Skill: ${current === null ? 'write' : 'update'} ${skillFile}.`);
      if (await ask('Install the gournal skill?', true)) {
        writeAtomic(skillFile, SKILL_MD, platform);
        io.out('Skill: installed.');
      } else io.out('Skill: skipped.');
    }

    // 3. Stop hook (opt in)
    if (opts.yes && !opts.hook) {
      io.out('Stop hook: not enabled (add --hook to enable it).');
    } else {
      const read = readSettings(settingsFile);
      if (read.kind === 'invalid') {
        io.err(`Stop hook: ${settingsFile} is not a valid JSON object. Gournal did not change it.`);
        status = 1;
      } else {
        const { next, changed, action } = addStopHook(read.settings, hook);
        if (!changed) io.out('Stop hook: already set up.');
        else {
          const plan = action === 'updated'
            ? `update the gournal hook in ${settingsFile} to ${planCommand}`
            : `add ${planCommand} to ${settingsFile}`;
          io.out(`Stop hook: ${plan}${read.exists ? ` (backup: ${backupFile})` : ''}.`);
          if (await ask(action === 'updated' ? 'Update the gournal Stop hook?' : 'Add the gournal Stop hook?', opts.hook)) {
            writeSettings(read, next, true);
            io.out(`Stop hook: ${action}.`);
          } else io.out('Stop hook: skipped.');
        }
      }
    }
    return status;
  }

  // Uninstall
  if (readRegistration(claudeJson) === null) io.out('MCP server: not set up.');
  else {
    io.out(`MCP server: remove the gournal registration (claude ${removeArgs.join(' ')}).`);
    if (await ask('Remove the gournal MCP registration?', true)) {
      const res = await runClaude(removeArgs);
      if (res === 'ok') io.out('MCP server: removed.');
      else if (res === 'missing') {
        io.out(`MCP server: the claude CLI was not found on PATH. Run this command yourself:\n  claude ${removeArgs.join(' ')}`);
        status = 1; // The registration is still there. Do not exit 0.
      } else status = 1;
    } else io.out('MCP server: kept.');
  }

  if (!fs.existsSync(skillFile)) io.out('Skill: not set up.');
  else if (!fs.readFileSync(skillFile, 'utf8').includes(SKILL_MARKER)) {
    io.out(`Skill: ${skillFile} was not written by gournal. Left alone.`);
  } else {
    io.out(`Skill: remove ${skillFile}.`);
    if (await ask('Remove the gournal skill?', true)) {
      fs.rmSync(skillFile, { force: true });
      try { fs.rmdirSync(path.dirname(skillFile)); } catch { /* not empty: keep it */ }
      io.out('Skill: removed.');
    } else io.out('Skill: kept.');
  }

  const read = readSettings(settingsFile);
  if (read.kind === 'invalid') {
    io.err(`Stop hook: ${settingsFile} is not a valid JSON object. Gournal did not change it.`);
    status = 1;
  } else {
    const { next, changed } = removeStopHook(read.settings, hook);
    if (!changed) io.out('Stop hook: not set up.');
    else {
      // Only a backup that install took before its first write holds the original file.
      const hasOriginal = fs.existsSync(backupFile);
      io.out(`Stop hook: remove the gournal hook from ${settingsFile}${hasOriginal ? ` (original backup: ${backupFile})` : ''}.`);
      if (await ask('Remove the gournal Stop hook?', true)) {
        writeSettings(read, next, false);
        io.out(`Stop hook: removed.${hasOriginal ? ` The original file is kept at ${backupFile}.` : ''}`);
      } else io.out('Stop hook: kept.');
    }
  }
  return status;
}
