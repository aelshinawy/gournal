import path from 'path';
import type { RepoIdentity } from '../core';

export interface IdentityDeps {
  identity: (cwd: string) => RepoIdentity;
  /** File paths of the client roots. [] when the client has no roots capability. */
  roots: () => Promise<string[]>;
  processCwd: () => string;
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
    let dir = args.cwd && path.isAbsolute(args.cwd) ? args.cwd : undefined;
    if (!dir) {
      try { dir = (await deps.roots())[0]; } catch { dir = undefined; }
    }
    if (!dir && args.project === undefined) dir = deps.processCwd();
    if (dir) {
      try { base = deps.identity(dir); } catch { base = undefined; }
    }
  }
  return {
    project: args.project ?? base?.project ?? 'uncategorized',
    repo: args.repo ?? base?.repo ?? null,
    branch: args.branch ?? base?.branch ?? null,
  };
}
