import { formatDay, subDays } from './dates';
import type { Entry } from './types';

export interface StatsModel { total: number; streak: number; byProject: [string, number][]; byTag: [string, number][] }

const countBy = (values: string[]): [string, number][] =>
  Array.from(values.reduce((acc, v) => acc.set(v, (acc.get(v) || 0) + 1), new Map<string, number>()))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const currentStreak = (entries: Entry[], now: Date): number => {
  const key = (d: Date) => formatDay(d);
  const days = new Set(entries.map((e) => key(new Date(e.createdAt))));
  let cursor = days.has(key(now)) ? now : subDays(now, 1);
  let streak = 0;
  while (days.has(key(cursor))) {
    streak++;
    cursor = subDays(cursor, 1);
  }
  return streak;
};

export function buildStats(entries: Entry[], now: Date): StatsModel {
  return {
    total: entries.length,
    streak: currentStreak(entries, now),
    byProject: countBy(entries.map((e) => e.project)),
    byTag: countBy(entries.flatMap((e) => e.tags)),
  };
}
