import { execFile } from 'child_process';
import type { CommandRunner } from './runner';

/**
 * The environment that Claude Code gives a server: no version manager, no GOURNAL_HOME, a short PATH.
 * The check runs the launcher with it, so a launcher that needs the shell of the user fails here.
 */
export function minimalEnv(platform: NodeJS.Platform, userHome: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (platform !== 'win32') return { HOME: userHome, PATH: '/usr/bin:/bin' };
  const out: NodeJS.ProcessEnv = { USERPROFILE: userHome };
  for (const key of ['SystemRoot', 'APPDATA', 'LOCALAPPDATA']) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  out.PATH = `${env.SystemRoot ?? 'C:\\Windows'}\\System32`;
  return out;
}

/** Run a command with the minimal environment. ENOENT maps to code 127. It never throws. */
export function createLauncherCheck(platform: NodeJS.Platform, userHome: string): CommandRunner {
  return (file, args) =>
    new Promise((resolve) => {
      const done = (error: Error | null, stdout: string, stderr: string): void => {
        if (error === null) return resolve({ code: 0, stdout, stderr });
        const e = error as NodeJS.ErrnoException & { code?: string | number };
        if (e.code === 'ENOENT') return resolve({ code: 127, stdout, stderr: e.message });
        resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout, stderr: stderr || e.message });
      };
      try {
        execFile(file, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, env: minimalEnv(platform, userHome) }, done);
      } catch (error) {
        done(error as Error, '', '');
      }
    });
}
