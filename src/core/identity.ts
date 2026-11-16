import { resolveProjectAlias } from './query';
import { DEFAULT_PROJECT } from './sanitize';

export interface RepoIdentity {
  project: string;
  repo: string | null;
  branch: string | null;
}

/** 'owner/name' from a git remote URL, or null when the URL has no owner and name. */
export function parseRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  let pathPart: string | undefined;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(trimmed);
  if (scheme) {
    pathPart = scheme[1];
  } else {
    const scp = /^[^@/\s]+@[^:/\s]+:(.+)$/.exec(trimmed);
    if (scp) pathPart = scp[1];
  }
  if (!pathPart) return null;
  const parts = pathPart.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/** Project name for a place. Alias keys, in order: full repo, repo name, folder. */
export function projectFor(
  facts: { repo: string | null; folder: string | null },
  aliases: Record<string, string>,
): string {
  const repoName = facts.repo ? facts.repo.slice(facts.repo.lastIndexOf('/') + 1) : null;
  for (const key of [facts.repo, repoName, facts.folder]) {
    if (!key) continue;
    const mapped = resolveProjectAlias(key, aliases);
    if (mapped !== key) return mapped;
  }
  return repoName ?? facts.folder ?? DEFAULT_PROJECT;
}
