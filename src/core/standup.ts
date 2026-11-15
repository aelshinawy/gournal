import type { Period } from './periods';
import type { Entry } from './types';
import { groupBy } from './group';
import { activityCounts } from './activity';
import type { Activity, ActivityCounts } from './activity';

export const shortId = (id: string): string => id.slice(-8);

export interface StandupModel {
  title: string; start: string; end: string; isMultiDay: boolean;
  done: { project: string; entries: Entry[] }[];
  blockers: Entry[]; next: Entry[];
  stale: { count: number; ids: string[]; days: number };
  /** Activity linked to an entry, by entry id. */
  linked: Record<string, Activity[]>;
  /** Activity with no entry. Null when there is none. */
  also: { activity: Activity[]; counts: ActivityCounts } | null;
}

const DAY_MS = 86_400_000;
const byCreatedAt = (a: Entry, b: Entry): number => Date.parse(a.createdAt) - Date.parse(b.createdAt);

export function buildStandup(input: {
  period: Period; done: Entry[]; open: Entry[]; now: Date; staleAfterDays: number;
  linked?: Record<string, Activity[]>; unlinked?: Activity[];
}): StandupModel {
  const { period, now, staleAfterDays } = input;
  const linked = input.linked ?? {};
  const linkedIds = new Set(Object.values(linked).flatMap((list) => list.map((a) => a.id)));
  const free = (input.unlinked ?? []).filter((a) => !linkedIds.has(a.id));
  const done = input.done.filter((e) => e.kind === 'done');
  const end = period.end.getTime();
  const open = input.open
    .filter((e) => (e.kind === 'blocker' || e.kind === 'next') && e.status === 'open')
    .filter((e) => Date.parse(e.createdAt) <= end)
    .sort(byCreatedAt);
  const isStale = (e: Entry) => now.getTime() - Date.parse(e.createdAt) > staleAfterDays * DAY_MS;
  const fresh = open.filter((e) => !isStale(e));
  const stale = open.filter(isStale);
  return {
    title: period.title,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    isMultiDay: period.isMultiDay,
    done: Array.from(groupBy(done, (e) => e.project), ([project, entries]) => ({ project, entries })),
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
