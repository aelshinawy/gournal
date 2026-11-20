import path from 'path';
import { DEFAULT_PROJECT, type RepoIdentity } from '../../core';

export interface IdentityDeps {
  identity: (cwd: string) => RepoIdentity;
  /** File paths of the client roots. [] when the client has no roots capability. */
  roots: () => Promise<string[]>;
  processCwd: () => string;
  /** Test seam. The default is process.platform. */
  platform?: NodeJS.Platform;
}

/**
 * An agent in Git Bash can pass `/c/Users/x/repo`. Native git on Windows cannot read that path.
 * On Windows, a leading single drive letter segment becomes `C:/Users/x/repo`. `/c` becomes `C:/`.
 * Every other path stays as it is.
 */
export function msysToWindowsPath(dir: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return dir;
  const m = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(dir);
  return m ? `${m[1]!.toUpperCase()}:/${m[2] ?? ''}` : dir;
}

/**
 * Identity for one MCP call. An explicit project, repo, or branch wins per field.
 * The other fields come from cwd, else the first client root, else the process cwd.
 * The process cwd is used only when the call has no project.
 */
export async function resolveCallIdentity(
  args: { project?: string; repo?: string; branch?: string; cwd?: string },
  deps: IdentityDeps,
): Promise<RepoIdentity> {
  let base: RepoIdentity | undefined;
  const needsBase = args.project === undefined || args.repo === undefined || args.branch === undefined;
  if (needsBase) {
    // A relative cwd would resolve against the server's own cwd, so it counts as absent.
    const platform = deps.platform ?? process.platform;
    const given = args.cwd ? msysToWindowsPath(args.cwd, platform) : undefined;
    const isAbsolute = platform === 'win32' ? path.win32.isAbsolute : path.isAbsolute;
    let dir = given && isAbsolute(given) ? given : undefined;
    if (!dir) {
      try { dir = (await deps.roots())[0]; } catch { dir = undefined; }
    }
    if (!dir && args.project === undefined) dir = deps.processCwd();
    if (dir) {
      try { base = deps.identity(dir); } catch { base = undefined; }
    }
  }
  return {
    project: args.project ?? base?.project ?? DEFAULT_PROJECT,
    repo: args.repo ?? base?.repo ?? null,
    branch: args.branch ?? base?.branch ?? null,
  };
}
