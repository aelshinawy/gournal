import { differenceInDays, formatDay, formatMonthDay, startOfDay, startOfMonth, startOfWeek, subDays } from '../dates';
import type { WeekDay } from '../config';
import { parseBound } from '../entries/query';

type PeriodName = 'today' | 'yesterday' | 'week' | 'month' | 'range';
export interface PeriodOptions { yesterday?: boolean; week?: boolean; month?: boolean; from?: string; to?: string }
export interface Period { name: PeriodName; start: Date; end: Date; title: string; isMultiDay: boolean }

function build(name: PeriodName, start: Date, end: Date, title: string): Period {
  return { name, start, end, title, isMultiDay: differenceInDays(end, start) > 0 };
}

export function resolvePeriod(opts: PeriodOptions, now: Date, weekStartsOn: WeekDay): Period {
  if (opts.from || opts.to) {
    const end = opts.to ? new Date(parseBound(opts.to, 'to')) : now;
    const start = opts.from ? new Date(parseBound(opts.from, 'from')) : startOfDay(end);
    const title = `Range (${formatDay(start)} - ${formatDay(end)})`;
    return build('range', start, end, title);
  }
  if (opts.month) {
    return build('month', startOfMonth(now), now,
      `Monthly (${formatMonthDay(startOfMonth(now))} - ${formatMonthDay(now)})`);
  }
  if (opts.week) {
    const start = startOfWeek(now, weekStartsOn);
    return build('week', start, now, `Weekly (${formatMonthDay(start)} - ${formatMonthDay(now)})`);
  }
  if (opts.yesterday) {
    return build('yesterday', startOfDay(subDays(now, 1)), now,
      `Yesterday (${formatMonthDay(subDays(now, 1))} → ${formatMonthDay(now)})`);
  }
  return build('today', startOfDay(now), now, `Today (${formatDay(now)})`);
}
