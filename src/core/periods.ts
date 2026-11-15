import { differenceInDays, endOfDay, format, startOfDay, startOfMonth, startOfWeek, subDays } from 'date-fns';
import type { WeekDay } from './config';
import { parseBound } from './query';

export type PeriodName = 'today' | 'yesterday' | 'week' | 'month' | 'range';
export interface PeriodOptions { yesterday?: boolean; week?: boolean; month?: boolean; from?: string; to?: string }
export interface Period { name: PeriodName; start: Date; end: Date; title: string; isMultiDay: boolean }

function build(name: PeriodName, start: Date, end: Date, title: string): Period {
  return { name, start, end, title, isMultiDay: differenceInDays(end, start) > 0 };
}

export function resolvePeriod(opts: PeriodOptions, now: Date, weekStartsOn: WeekDay): Period {
  if (opts.from || opts.to) {
    const end = opts.to ? new Date(parseBound(opts.to, 'to')) : now;
    const start = opts.from ? new Date(parseBound(opts.from, 'from')) : startOfDay(end);
    const title = `Range (${format(start, 'yyyy-MM-dd')} - ${format(end, 'yyyy-MM-dd')})`;
    return build('range', start, end, title);
  }
  if (opts.month) {
    return build('month', startOfMonth(now), now,
      `Monthly (${format(startOfMonth(now), 'MMM dd')} - ${format(now, 'MMM dd')})`);
  }
  if (opts.week) {
    const start = startOfWeek(now, { weekStartsOn });
    return build('week', start, now, `Weekly (${format(start, 'MMM dd')} - ${format(now, 'MMM dd')})`);
  }
  if (opts.yesterday) {
    return build('yesterday', startOfDay(subDays(now, 1)), now,
      `Yesterday (${format(subDays(now, 1), 'MMM dd')} → ${format(now, 'MMM dd')})`);
  }
  return build('today', startOfDay(now), now, `Today (${format(now, 'yyyy-MM-dd')})`);
}
