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
    dates.subDays(d, 1).toISOString()
  ];
});

const out = {
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offset: new Date(2026, 0, 15).getTimezoneOffset(),
  instants,
  local: [dates.parseIso('2026-03-29').toISOString(), new Date('2026-03-29').toISOString()]
};

process.stdout.write(`${JSON.stringify(out)}\n`);
