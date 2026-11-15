import { execFileSync } from 'child_process';
import path from 'path';
import { parseRemoteUrl, projectFor, type RepoIdentity } from '../../core';

function git(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      timeout: 2000,
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
  let folder: string | null = null;
  let repo: string | null = null;
  let branch: string | null = null;
  try {
    const paths = git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir']);
    if (paths) {
      const [toplevel, commonDir] = paths.split('\n');
      if (toplevel) {
        const main = commonDir && path.basename(commonDir) === '.git' ? path.dirname(commonDir) : toplevel;
        folder = path.basename(main) || null;
      }
    }
    if (folder !== null) {
      branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']) || null;
      const url = git(cwd, ['remote', 'get-url', 'origin']);
      repo = url ? parseRemoteUrl(url) : null;
    }
    return { project: projectFor({ repo, folder }, aliases), repo, branch };
  } catch {
    return { project: 'uncategorized', repo: null, branch: null };
  }
}
