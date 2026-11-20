import { execFileSync } from 'child_process';
import path from 'path';
import { resolveBin } from '../bin';
import { DEFAULT_PROJECT, parseRemoteUrl, projectFor, type RepoIdentity } from '../../core';

const BUDGET_MS = 2000;

function git(bin: string, cwd: string, args: string[], deadline: number): string | null {
  const left = deadline - Date.now();
  if (left <= 0) return null;
  try {
    const out = execFileSync(bin, ['-C', cwd, ...args], {
      timeout: left,
      windowsHide: true,
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
  const bin = resolveBin('git');
  let folder: string | null = null;
  let repo: string | null = null;
  let branch: string | null = null;
  try {
    // No --path-format: Git older than 2.31 prints an unknown flag back as an output line.
    // git-common-dir can be relative to cwd, so resolve it against cwd.
    const paths = git(bin, cwd, ['rev-parse', '--show-toplevel', '--git-common-dir'], deadline);
    const lines = paths ? paths.split('\n').filter((l) => l !== '') : [];
    if (lines.length === 2) {
      const [toplevel, commonLine] = lines;
      const commonDir = path.resolve(cwd, commonLine);
      const main = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : toplevel;
      folder = path.basename(main) || null;
    }
    if (folder !== null) {
      branch = git(bin, cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], deadline) || null;
      const url = git(bin, cwd, ['remote', 'get-url', 'origin'], deadline);
      repo = url ? parseRemoteUrl(url) : null;
    }
    return { project: projectFor({ repo, folder }, aliases), repo, branch };
  } catch {
    return { project: DEFAULT_PROJECT, repo: null, branch: null };
  }
}
