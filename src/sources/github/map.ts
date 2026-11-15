import type { NewActivityInput } from '../../core';

export interface SearchItem {
  number: number;
  title: string;
  repository_url: string;
  user?: { login?: string } | null;
}

/** "owner/name" from the last two path parts of repository_url, exactly as GitHub returns it. */
export function repoOf(item: SearchItem): string {
  return item.repository_url.split('/').slice(-2).join('/');
}

export function sameLogin(a: string | null | undefined, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapPull(repo: string, pull: any): NewActivityInput[] {
  const pr = pull.number as number;
  const base = { repo, externalId: String(pr), title: pull.title ?? null, url: pull.html_url ?? null, branch: pull.head?.ref ?? null, pr };
  const out: NewActivityInput[] = [{
    ...base, type: 'pr_opened', occurredAt: pull.created_at,
    payload: { pr, state: pull.state, draft: pull.draft, base: pull.base?.ref },
  }];
  if (pull.merged_at) {
    out.push({ ...base, type: 'pr_merged', occurredAt: pull.merged_at, payload: { pr, mergedBy: pull.merged_by?.login ?? null } });
  }
  return out;
}

export function mapCommit(repo: string, pr: number, branch: string | null, c: any, login: string): NewActivityInput | null {
  if (!sameLogin(c.author?.login, login)) return null;
  return {
    type: 'commit', occurredAt: c.commit.author.date, repo, branch,
    externalId: String(c.sha).toLowerCase(),
    title: String(c.commit.message ?? '').split('\n')[0],
    url: c.html_url ?? null, pr, payload: { pr },
  };
}

export function mapReview(repo: string, pr: number, title: string, r: any, login: string): NewActivityInput | null {
  if (r.state === 'PENDING' || !r.submitted_at) return null;
  if (!sameLogin(r.user?.login, login)) return null;
  return {
    type: 'review', occurredAt: r.submitted_at, repo, branch: null,
    externalId: String(r.id), title, url: r.html_url ?? null, pr, payload: { pr, state: r.state },
  };
}
