// A reference wrapper over date-fns. The date test pins its output.
// Task 2 adds src/core/dates.ts with the same names and the same output.
import {
  addDays as dfAddDays,
  differenceInDays as dfDifferenceInDays,
  endOfDay as dfEndOfDay,
  format,
  parse,
  parseISO,
  startOfDay as dfStartOfDay,
  startOfMonth as dfStartOfMonth,
  startOfWeek as dfStartOfWeek,
  subDays as dfSubDays
} from 'date-fns';
import type { WeekDay } from '../../../src/core/config';

export const formatDay = (d: Date): string => format(d, 'yyyy-MM-dd');
export const formatMonthDay = (d: Date): string => format(d, 'MMM dd');
export const formatWeekdayMonthDay = (d: Date): string => format(d, 'EEE MMM dd');
export const formatTime = (d: Date): string => format(d, 'HH:mm');
export const formatWeekdayDayTime = (d: Date): string => format(d, 'EEE dd HH:mm');
export const formatWeekdayDayDashTime = (d: Date): string => format(d, 'EEE dd - HH:mm');
export const formatDayTime = (d: Date): string => format(d, 'yyyy-MM-dd HH:mm');
export const formatMonthWeekdayDayDashTime = (d: Date): string => format(d, 'MMM EEE dd - HH:mm');

export const startOfDay = (d: Date): Date => dfStartOfDay(d);
export const endOfDay = (d: Date): Date => dfEndOfDay(d);
export const startOfMonth = (d: Date): Date => dfStartOfMonth(d);
export const startOfWeek = (d: Date, w: WeekDay): Date => dfStartOfWeek(d, { weekStartsOn: w });

export const addDays = (d: Date, n: number): Date => dfAddDays(d, n);
export const subDays = (d: Date, n: number): Date => dfSubDays(d, n);
export const differenceInDays = (later: Date, earlier: Date): number => dfDifferenceInDays(later, earlier);

export const parseDay = (s: string): Date => parse(s, 'yyyy-MM-dd', new Date());
export const parseIso = parseISO;
