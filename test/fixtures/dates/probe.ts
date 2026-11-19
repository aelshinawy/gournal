// Child process for test/core/dates.test.ts. It prints one JSON line.
// The test sets TZ in the child env. Each argument is an ISO instant.
import * as dates from '../../../src/core/dates';

const instants = process.argv.slice(2).map((iso) => {
  const d = new Date(iso);
  return [
    dates.formatDay(d),
    dates.formatMonthDay(d),
    dates.formatWeekdayMonthDay(d),
    dates.formatTime(d),
    dates.formatWeekdayDayTime(d),
    dates.formatWeekdayDayDashTime(d),
    dates.formatDayTime(d),
    dates.formatMonthWeekdayDayDashTime(d),
    dates.startOfDay(d).toISOString(),
    dates.endOfDay(d).toISOString(),
    dates.addDays(d, 1).toISOString(),
    dates.subDays(d, 1).toISOString(),
    dates.startOfWeek(d, 0).toISOString(),
    dates.startOfWeek(d, 1).toISOString(),
    dates.startOfMonth(d).toISOString()
  ];
});

// Fixed local pairs [later, earlier], each as [year, month, day, hour, minute]. The test pins the results per zone.
const PAIRS: [number[], number[]][] = [
  [[2026, 3, 9], [2026, 3, 8]],
  [[2026, 3, 30], [2026, 3, 29]],
  [[2026, 3, 9, 23, 30], [2026, 3, 8, 0, 30]],
  [[2026, 11, 2], [2026, 11, 1]],
  [[2026, 3, 8, 23, 30], [2026, 3, 8, 0, 30]],
  [[2026, 10, 25, 23, 30], [2026, 10, 25, 0, 30]],
  [[2026, 11, 1, 23, 30], [2026, 11, 1, 0, 30]]
];
const local = ([y, m, d, h = 0, mi = 0]: number[]): Date => new Date(y, m - 1, d, h, mi);
const diffs = PAIRS.map(([later, earlier]) => dates.differenceInDays(local(later), local(earlier)));

const out = {
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offset: new Date(2026, 0, 15).getTimezoneOffset(),
  instants,
  diffs,
  local: [dates.parseIso('2026-03-29').toISOString(), new Date('2026-03-29').toISOString()]
};

process.stdout.write(`${JSON.stringify(out)}\n`);
