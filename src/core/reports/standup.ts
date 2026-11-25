import type { Period } from './periods';
import type { Entry } from '../entries/entry';
import { groupBy } from './group';
import { shortId } from '../ids';
import { activityCounts } from '../activity/activity';
import type { Activity, ActivityCounts } from '../activity/activity';
import { resolveQuery } from '../entries/query';
import { projectFor } from '../labels/project';

export interface StandupModel {
  title: string; start: string; end: string; isMultiDay: boolean;
  done: { project: string; entries: Entry[] }[];
  blockers: Entry[]; next: Entry[];
  stale: { count: number; ids: string[]; days: number };
  /** Activity linked to an entry, by entry id. */
  linked: Record<string, Activity[]>;
  /** Activity in the period that is not folded under a shown done entry. Null when there is none. */
  also: { activity: Activity[]; counts: ActivityCounts } | null;
}

const DAY_MS = 86_400_000;
const byCreatedAt = (a: Entry, b: Entry): number => Date.parse(a.createdAt) - Date.parse(b.createdAt);

/**
 * The caller's query guarantees the input. `done` holds only done entries. `open` holds only open
 * blockers and next items created on or before the period end.
 */
export function buildStandup(input: {
  period: Period; done: Entry[]; open: Entry[]; now: Date; staleAfterDays: number;
  linked?: Record<string, Activity[]>;
  /** The activity of the period. The ids in `linked` are subtracted from it to make Also. */
  unlinked?: Activity[];
}): StandupModel {
  const { period, now, staleAfterDays } = input;
  const linked = input.linked ?? {};
  const linkedIds = new Set(Object.values(linked).flatMap((list) => list.map((a) => a.id)));
  const free = (input.unlinked ?? []).filter((a) => !linkedIds.has(a.id));
  const open = [...input.open].sort(byCreatedAt);
  const isStale = (e: Entry) => now.getTime() - Date.parse(e.createdAt) > staleAfterDays * DAY_MS;
  const fresh = open.filter((e) => !isStale(e));
  const stale = open.filter(isStale);
  return {
    title: period.title,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    isMultiDay: period.isMultiDay,
    done: Array.from(groupBy(input.done, (e) => e.project), ([project, entries]) => ({ project, entries })),
    blockers: fresh.filter((e) => e.kind === 'blocker'),
    next: fresh.filter((e) => e.kind === 'next'),
    stale: { count: stale.length, ids: stale.map((e) => shortId(e.id)), days: staleAfterDays },
    linked,
    also: free.length > 0 ? { activity: free, counts: activityCounts(free) } : null,
  };
}

export function isEmptyStandup(m: StandupModel): boolean {
  return m.done.length === 0 && m.blockers.length === 0 && m.next.length === 0 && m.stale.count === 0 && m.also === null;
}

/**
 * Activity has no tags, so a tags filter hides it. A project filter keeps the activity whose repo maps
 * to that project through the aliases. A repo filter is applied by the activity query, without case.
 */
export function filterActivity(list: Activity[], opts: { project?: string; tags?: string[] }, aliases: Record<string, string>): Activity[] {
  if (opts.tags && opts.tags.length > 0) return [];
  if (!opts.project) return list;
  const wanted = (resolveQuery({ project: opts.project }, aliases).projects ?? []).map((p) => p.toLowerCase());
  return list.filter((a) => wanted.includes(projectFor({ repo: a.repo, folder: null }, aliases).toLowerCase()));
}
