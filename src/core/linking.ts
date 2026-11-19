import { addDays, startOfWeek } from './dates';
import type { Activity } from './activity';
import type { WeekDay } from './config';
import type { Entry } from './types';

type LinkReason = 'pr-match' | 'sha-match' | 'branch-window';
export interface LinkCandidate { entryId: string; activityId: string; reason: LinkReason }

export const BRANCH_WINDOW_MS = 7_200_000;
const MIN_SHA_LENGTH = 7;

function sameRepo(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function parsePr(value: string): number | null {
  const m = /^#?(\d+)$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Correct when `activity` holds every live activity with each PR number that the entries reference,
 * and `entries` holds every live done entry within 2 h of each activity that has a branch.
 * One candidate per (entryId, activityId). pr-match wins over sha-match, sha-match over branch-window.
 */
export function matchLinks(input: { entries: Entry[]; activity: Activity[]; weekStartsOn: WeekDay }): LinkCandidate[] {
  const entries = input.entries.filter((e) => e.deletedAt === null);
  const activity = input.activity.filter((a) => a.deletedAt === null);
  const found = new Map<string, LinkCandidate>();
  const add = (entryId: string, activityId: string, reason: LinkReason): void => {
    const key = `${entryId}\u0000${activityId}`;
    if (!found.has(key)) found.set(key, { entryId, activityId, reason });
  };

  const byPr = new Map<number, Activity[]>();
  const commits: Activity[] = [];
  for (const a of activity) {
    if (a.pr !== null) {
      const list = byPr.get(a.pr);
      if (list) list.push(a); else byPr.set(a.pr, [a]);
    }
    if (a.type === 'commit') commits.push(a);
  }

  // 1. pr-match
  for (const e of entries) {
    for (const ref of e.refs) {
      if (ref.type !== 'pr') continue;
      const n = parsePr(ref.value);
      const candidates = n === null ? undefined : byPr.get(n);
      if (!candidates) continue;
      const repo = ref.repo ?? e.repo;
      if (repo) {
        for (const a of candidates) if (sameRepo(a.repo, repo)) add(e.id, a.id, 'pr-match');
        continue;
      }
      const start = startOfWeek(new Date(e.createdAt), input.weekStartsOn);
      const end = addDays(start, 7);
      const inWeek = candidates.filter((a) => {
        const t = new Date(a.occurredAt);
        return t >= start && t < end;
      });
      const repos = new Set(inWeek.map((a) => a.repo.toLowerCase()));
      if (repos.size === 1) for (const a of inWeek) add(e.id, a.id, 'pr-match');
    }
  }

  // 2. sha-match. With a known repo the commit must be in it. With no repo, any repo matches.
  for (const e of entries) {
    for (const ref of e.refs) {
      if (ref.type !== 'commit') continue;
      const sha = ref.value.trim().toLowerCase();
      if (sha.length < MIN_SHA_LENGTH || !/^[0-9a-f]+$/.test(sha)) continue;
      const repo = ref.repo ?? e.repo;
      const hits = commits.filter((a) => a.externalId.toLowerCase().startsWith(sha) && (!repo || sameRepo(a.repo, repo)));
      if (hits.length === 1) add(e.id, hits[0].id, 'sha-match');
    }
  }

  // 3. branch-window
  const done = entries.filter((e) => e.kind === 'done' && e.repo && e.branch);
  for (const a of activity) {
    if (!a.branch) continue;
    const t = new Date(a.occurredAt).getTime();
    const fits = done.filter((e) => sameRepo(e.repo, a.repo) && e.branch === a.branch
      && Math.abs(new Date(e.createdAt).getTime() - t) <= BRANCH_WINDOW_MS);
    if (fits.length === 1) add(fits[0].id, a.id, 'branch-window');
  }

  return [...found.values()];
}
