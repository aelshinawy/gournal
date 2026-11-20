import path from 'path';
import { execFile } from 'child_process';
import { resolveBin, resolveWinShim } from '../../sources';

/** ENOENT (the binary is missing) maps to code 127. */
export type CommandRunner = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

interface ExecOptions { windowsHide: true; windowsVerbatimArguments?: true; env?: NodeJS.ProcessEnv }
type RunResult = Awaited<ReturnType<CommandRunner>>;
/** One process start, with no retry. ENOENT maps to code 127. */
export type ExecOnce = (file: string, args: string[], options: ExecOptions) => Promise<RunResult>;

/** Production: execFile, no shell. Never throws. */
const execOnce: ExecOnce = (file, args, options) =>
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

interface RunnerDeps {
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
