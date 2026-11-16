import os from 'os';
import path from 'path';

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path;
}

/** Compare two paths. Windows paths differ only by case when they name the same folder. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const p = pathApi(platform);
  const left = p.resolve(a);
  const right = p.resolve(b);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * The user's profile folder. On Windows, HOME can come from Git Bash or another tool and can point
 * away from the real profile. Windows ignores HOME: it uses USERPROFILE, then the OS home folder.
 * Other systems keep HOME, then USERPROFILE, then the OS home folder.
 */
function profileDir(platform: NodeJS.Platform): string {
  if (platform === 'win32') return process.env.USERPROFILE || os.homedir();
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * The folder that holds the `.claude` folder of the user. It matches the profile folder of the
 * gournal home on Windows. On other systems it is os.homedir(), as before.
 */
export function userHomePath(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? profileDir(platform) : os.homedir();
}

/** The built-in home, ~/.gournal. It does not read GOURNAL_HOME. */
export function defaultHomePath(platform: NodeJS.Platform = process.platform): string {
  return pathApi(platform).join(profileDir(platform), '.gournal');
}

/**
 * True when dir is the built-in home and the user did not choose it with GOURNAL_HOME.
 * Gournal changes the mode of existing files only in this home. A custom home is never touched.
 */
export function isDefaultHome(dir: string, platform: NodeJS.Platform = process.platform): boolean {
  if (process.env.GOURNAL_HOME) return false;
  return samePath(dir, defaultHomePath(platform), platform);
}

export function gournalHome(platform: NodeJS.Platform = process.platform): string {
  const home = process.env.GOURNAL_HOME || defaultHomePath(platform);
  // Test guard: test/setup-env.ts records the real home. No test may open its .gournal.
  if (process.env.JEST_WORKER_ID && process.env.GOURNAL_REAL_HOME) {
    if (samePath(home, pathApi(platform).join(process.env.GOURNAL_REAL_HOME, '.gournal'), platform)) {
      throw new Error('refusing to use the real gournal home under test');
    }
  }
  return home;
}
