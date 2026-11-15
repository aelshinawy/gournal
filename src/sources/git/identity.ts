import { execFileSync } from 'child_process';
import path from 'path';
import { parseRemoteUrl, projectFor, type RepoIdentity } from '../../core';

const BUDGET_MS = 2000;

function git(cwd: string, args: string[], deadline: number): string | null {
  const left = deadline - Date.now();
  if (left <= 0) return null;
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      timeout: left,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return out.trim();
  } catch {
    return null;
  }
}

/** Project, repo, and branch for a directory. A worktree maps to its main repository. Never throws. */
export function resolveIdentity(cwd: string, aliases: Record<string, string>): RepoIdentity {
  const deadline = Date.now() + BUDGET_MS;
  let folder: string | null = null;
  let repo: string | null = null;
  let branch: string | null = null;
  try {
    const paths = git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], deadline);
    if (paths) {
      const [toplevel, commonDir] = paths.split('\n');
      if (toplevel) {
        const main = commonDir && path.basename(commonDir) === '.git' ? path.dirname(commonDir) : toplevel;
        folder = path.basename(main) || null;
      }
    }
    if (folder !== null) {
      branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], deadline) || null;
      const url = git(cwd, ['remote', 'get-url', 'origin'], deadline);
      repo = url ? parseRemoteUrl(url) : null;
    }
    return { project: projectFor({ repo, folder }, aliases), repo, branch };
  } catch {
    return { project: 'uncategorized', repo: null, branch: null };
  }
}
