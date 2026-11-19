import type { WeekDay } from './config';

// Local-time date helpers for core. Each function copies its input and uses local setters.
// Names are fixed English, so output does not depend on the process locale.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MS_PER_DAY = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Throws on an invalid date, as the formatter it replaces did. */
function checked(d: Date): Date {
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid time value');
  return d;
}

function year(d: Date): string {
  const y = d.getFullYear();
  return y < 0 ? `-${String(-y).padStart(4, '0')}` : String(y).padStart(4, '0');
}

export const formatDay = (d: Date): string => `${year(checked(d))}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const formatMonthDay = (d: Date): string => `${MONTHS[checked(d).getMonth()]} ${pad(d.getDate())}`;
export const formatWeekdayMonthDay = (d: Date): string =>
  `${WEEKDAYS[checked(d).getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate())}`;
export const formatTime = (d: Date): string => `${pad(checked(d).getHours())}:${pad(d.getMinutes())}`;
export const formatWeekdayDayTime = (d: Date): string =>
  `${WEEKDAYS[checked(d).getDay()]} ${pad(d.getDate())} ${formatTime(d)}`;
export const formatWeekdayDayDashTime = (d: Date): string =>
  `${WEEKDAYS[checked(d).getDay()]} ${pad(d.getDate())} - ${formatTime(d)}`;
export const formatDayTime = (d: Date): string => `${formatDay(d)} ${formatTime(d)}`;
export const formatMonthWeekdayDayDashTime = (d: Date): string =>
  `${MONTHS[checked(d).getMonth()]} ${WEEKDAYS[d.getDay()]} ${pad(d.getDate())} - ${formatTime(d)}`;

export function startOfDay(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  return out;
}

export function endOfDay(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(23, 59, 59, 999);
  return out;
}

export function startOfMonth(d: Date): Date {
  const out = new Date(d.getTime());
  out.setDate(1);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function startOfWeek(d: Date, weekStartsOn: WeekDay): Date {
  const out = new Date(d.getTime());
  const day = out.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  out.setDate(out.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Adds calendar days. The local time stays the same across a DST change. */
export function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  if (Number.isNaN(n)) return new Date(NaN);
  if (n === 0) return out;
  out.setDate(out.getDate() + n);
  return out;
}

export const subDays = (d: Date, n: number): Date => addDays(d, -n);

// Local calendar day number: a UTC timestamp built from the local year, month, and day.
function dayNumber(d: Date): number {
  const u = new Date(0);
  u.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round(u.getTime() / MS_PER_DAY);
}

// Compares two dates by their local fields. NaN when either date is invalid.
function compareLocal(a: Date, b: Date): number {
  const diff =
    a.getFullYear() - b.getFullYear() ||
    a.getMonth() - b.getMonth() ||
    a.getDate() - b.getDate() ||
    a.getHours() - b.getHours() ||
    a.getMinutes() - b.getMinutes() ||
    a.getSeconds() - b.getSeconds() ||
    a.getMilliseconds() - b.getMilliseconds();
  if (diff < 0) return -1;
  if (diff > 0) return 1;
  return diff;
}

/** Whole days from `earlier` to `later`, sign aware. A part day does not count. */
export function differenceInDays(later: Date, earlier: Date): number {
  const l = new Date(later.getTime());
  const sign = compareLocal(l, earlier);
  const difference = Math.abs(dayNumber(l) - dayNumber(earlier));
  l.setDate(l.getDate() - sign * difference);
  const lastDayNotFull = Number(compareLocal(l, earlier) === -sign);
  const result = sign * (difference - lastDayNotFull);
  return result === 0 ? 0 : result;
}

/** Reads a strict `yyyy-MM-dd` day as local midnight. Gives an invalid date for any other input. */
export function parseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return new Date(NaN);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(0);
  d.setFullYear(y, mo - 1, da);
  d.setHours(0, 0, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return new Date(NaN);
  return d;
}

/** A bare `yyyy-MM-dd` string is a local day. Any other string goes to `new Date`. */
export function parseIso(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDay(s) : new Date(s);
}
