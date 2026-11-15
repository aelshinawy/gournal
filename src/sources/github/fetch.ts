import type { NewActivityInput } from '../../core';
import { GhError, type GhErrorKind, type GhRunner } from './gh';
import { mapCommit, mapPull, mapReview, repoOf, sameLogin, type SearchItem } from './map';

export interface FetchOptions {
  since: Date;
  login?: string;
  owners: { include: string[]; exclude: string[] };
  /** Epoch ms. The fetch does not start a call after it. */
  deadline?: number;
  callTimeoutMs: number;
}
export interface FetchResult {
  login: string; items: NewActivityInput[]; complete: boolean; stoppedBy: GhErrorKind | null;
  /** The `updated_at` of the last PR whose per-PR calls all finished. Null when none finished. */
  progressAt: string | null;
}

const PAGE = 100;
const MAX_SEARCH_PAGES = 10;
const MAX_COMMIT_PAGES = 3;

class Stop extends Error {
  constructor(readonly kind: GhErrorKind) { super(kind); }
}

function ownerAllowed(repo: string, owners: FetchOptions['owners']): boolean {
  const owner = repo.split('/')[0].toLowerCase();
  const inc = owners.include.map((o) => o.toLowerCase());
  const exc = owners.exclude.map((o) => o.toLowerCase());
  if (exc.includes(owner)) return false;
  return inc.length === 0 || inc.includes(owner);
}

export async function fetchActivity(gh: GhRunner, opts: FetchOptions): Promise<FetchResult> {
  const call = async (args: string[]): Promise<unknown> => {
    let timeoutMs = opts.callTimeoutMs;
    if (opts.deadline !== undefined) {
      const left = opts.deadline - Date.now();
      if (left <= 0) throw new Stop('timeout');
      timeoutMs = Math.min(timeoutMs, left);
    }
    try {
      return JSON.parse(await gh(args, { timeoutMs }));
    } catch (e) {
      if (e instanceof GhError) throw new Stop(e.kind);
      throw e;
    }
  };

  let login = opts.login;
  if (!login) {
    try {
      login = String(((await call(['api', 'user'])) as { login: string }).login);
    } catch (e) {
      if (e instanceof Stop) throw new GhError(e.kind, 'Could not read the GitHub login');
      throw e;
    }
  }
  const me = login;
  const since = opts.since.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const items: NewActivityInput[] = [];
  let progressAt: string | null = null;

  try {
    const search = async (q: string): Promise<SearchItem[]> => {
      const found: SearchItem[] = [];
      for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
        const res = (await call(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', `per_page=${PAGE}`, '-f', `page=${page}`, '-f', 'sort=updated', '-f', 'order=asc'])) as { items: SearchItem[] };
        found.push(...res.items);
        if (res.items.length < PAGE) break;
      }
      return found;
    };
    const own = await search(`is:pr author:${me} updated:>=${since}`);
    const reviewedAll = await search(`is:pr reviewed-by:${me} -author:${me} updated:>=${since}`);

    const ownKeys = new Set(own.map((i) => `${repoOf(i).toLowerCase()}#${i.number}`));
    const reviewed = reviewedAll.filter(
      (i) => !sameLogin(i.user?.login, me) && !ownKeys.has(`${repoOf(i).toLowerCase()}#${i.number}`),
    );

    // Both lists are ascending by updated_at. Merge them, so a stop leaves a clean prefix of finished PRs.
    const stamped = (item: SearchItem): number => {
      const t = Date.parse(item.updated_at ?? '');
      return Number.isFinite(t) ? t : 0;
    };
    const queue = [
      ...own.map((item) => ({ item, own: true })),
      ...reviewed.map((item) => ({ item, own: false })),
    ].sort((x, y) => stamped(x.item) - stamped(y.item));

    for (const { item, own: isOwn } of queue) {
      if (ownerAllowed(repoOf(item), opts.owners)) {
        const repo = repoOf(item);
        if (isOwn) {
          const pull = (await call(['api', `repos/${repo}/pulls/${item.number}`])) as { head?: { ref?: string } };
          items.push(...mapPull(repo, pull));
          const branch = pull.head?.ref ?? null;
          for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
            const commits = (await call(['api', '-X', 'GET', `repos/${repo}/pulls/${item.number}/commits`, '-f', `per_page=${PAGE}`, '-f', `page=${page}`])) as unknown[];
            for (const c of commits) {
              const mapped = mapCommit(repo, item.number, branch, c, me);
              if (mapped) items.push(mapped);
            }
            if (commits.length < PAGE) break;
          }
        } else {
          const reviews = (await call(['api', '-X', 'GET', `repos/${repo}/pulls/${item.number}/reviews`, '-f', `per_page=${PAGE}`, '-f', 'page=1'])) as unknown[];
          for (const r of reviews) {
            const mapped = mapReview(repo, item.number, item.title, r, me);
            if (mapped) items.push(mapped);
          }
        }
      }
      if (item.updated_at && Number.isFinite(Date.parse(item.updated_at))) progressAt = item.updated_at;
    }
  } catch (e) {
    if (e instanceof Stop) return { login: me, items, complete: false, stoppedBy: e.kind, progressAt };
    throw e;
  }
  return { login: me, items, complete: true, stoppedBy: null, progressAt };
}
