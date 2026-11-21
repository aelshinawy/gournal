import { execOnce, type CommandRunner } from './runner';

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

/** Run a command with the minimal environment. It never throws. */
export function createLauncherCheck(platform: NodeJS.Platform, userHome: string): CommandRunner {
  return (file, args) => execOnce(file, args, { windowsHide: true, env: minimalEnv(platform, userHome) });
}
