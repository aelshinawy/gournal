import { format } from 'date-fns';
import type { Period } from './periods';
import type { Entry } from './types';
import { groupBy } from './group';
import type { Activity } from './activity';

export interface WorkLogModel {
  title: string; start: string; end: string;
  days: { date: string; entries: Entry[] }[];
  count: number; projectCount: number;
  /** Activity linked to an entry, by entry id. Only entries in the period. */
  linked: Record<string, Activity[]>;
}

export function buildWorkLog(period: Period, entries: Entry[], linked: Record<string, Activity[]> = {}): WorkLogModel {
  const start = period.start.getTime();
  const end = period.end.getTime();
  const inPeriod = entries
    .filter((e) => { const t = Date.parse(e.createdAt); return t >= start && t <= end; })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const days = Array.from(groupBy(inPeriod, (e) => format(new Date(e.createdAt), 'yyyy-MM-dd')), ([date, list]) => ({ date, entries: list }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    title: period.title,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    days,
    count: inPeriod.length,
    projectCount: new Set(inPeriod.map((e) => e.project)).size,
    linked: Object.fromEntries(inPeriod.filter((e) => (linked[e.id]?.length ?? 0) > 0).map((e) => [e.id, linked[e.id]])),
  };
}
