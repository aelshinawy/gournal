import { spawnSync } from 'child_process';
import path from 'path';
import * as dates from '../fixtures/dates/date-fns-dates';

const ROOT = path.resolve(__dirname, '..', '..');
const PROBE = path.join('test', 'fixtures', 'dates', 'probe.ts');

type Probe = { zone: string; offset: number; instants: string[][]; local: string[] };

/** Run the probe in a child process with TZ set. Node reads TZ at start, so a zone needs a new process. */
function runProbe(zone: string, instants: string[]): Probe {
  const res = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', PROBE, ...instants], {
    cwd: ROOT,
    env: { ...process.env, TZ: zone },
    encoding: 'utf8'
  });
  if (res.status !== 0) throw new Error(`probe failed (${res.status}): ${res.stderr}`);
  return JSON.parse(res.stdout.trim()) as Probe;
}

const L = (y: number, m: number, d: number, h = 0, mi = 0): Date => new Date(y, m - 1, d, h, mi);
const fmt = dates.formatDayTime;

describe('date functions in the process zone', () => {
  test('startOfWeek returns the start day itself and the week before for the day before', () => {
    expect(fmt(dates.startOfWeek(L(2026, 3, 8, 0, 30), 0))).toBe('2026-03-08 00:00'); // Sunday, start day
    expect(fmt(dates.startOfWeek(L(2026, 3, 7, 23, 30), 0))).toBe('2026-03-01 00:00'); // day before
    expect(fmt(dates.startOfWeek(L(2026, 3, 30, 0, 30), 1))).toBe('2026-03-30 00:00'); // Monday, start day
    expect(fmt(dates.startOfWeek(L(2026, 3, 29, 23, 30), 1))).toBe('2026-03-23 00:00'); // day before
  });

  test('startOfMonth returns the first day at midnight', () => {
    expect(fmt(dates.startOfMonth(L(2026, 3, 29, 23, 30)))).toBe('2026-03-01 00:00');
  });

  test('differenceInDays counts whole calendar days across DST days', () => {
    expect(dates.differenceInDays(L(2026, 3, 9), L(2026, 3, 8))).toBe(1);
    expect(dates.differenceInDays(L(2026, 3, 30), L(2026, 3, 29))).toBe(1);
    expect(dates.differenceInDays(L(2026, 3, 9, 23, 30), L(2026, 3, 8, 0, 30))).toBe(1);
    expect(dates.differenceInDays(L(2026, 11, 2), L(2026, 11, 1))).toBe(1);
    expect(dates.differenceInDays(L(2026, 3, 8, 23, 30), L(2026, 3, 8, 0, 30))).toBe(0);
  });

  test('addDays keeps the wall clock time', () => {
    expect(fmt(dates.addDays(L(2026, 3, 7, 0, 30), 1))).toBe('2026-03-08 00:30');
    expect(fmt(dates.addDays(L(2026, 3, 28, 0, 30), 1))).toBe('2026-03-29 00:30');
    expect(fmt(dates.addDays(L(2026, 10, 24, 23, 30), 1))).toBe('2026-10-25 23:30');
  });

  test('parseDay reads a strict day at local midnight and gives an invalid date for a bad day', () => {
    expect(fmt(dates.parseDay('2026-03-29'))).toBe('2026-03-29 00:00');
    for (const bad of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10']) {
      expect(Number.isNaN(dates.parseDay(bad).getTime())).toBe(true);
    }
  });

  test('parseIso reads a bare day as local midnight', () => {
    expect(fmt(dates.parseIso('2026-03-29'))).toBe('2026-03-29 00:00');
  });

  test('each format function gives its pattern', () => {
    const d = L(2026, 3, 8, 0, 30);
    expect(dates.formatDay(d)).toBe('2026-03-08');
    expect(dates.formatMonthDay(d)).toBe('Mar 08');
    expect(dates.formatWeekdayMonthDay(d)).toBe('Sun Mar 08');
    expect(dates.formatTime(d)).toBe('00:30');
    expect(dates.formatWeekdayDayTime(d)).toBe('Sun 08 00:30');
    expect(dates.formatWeekdayDayDashTime(d)).toBe('Sun 08 - 00:30');
    expect(dates.formatDayTime(d)).toBe('2026-03-08 00:30');
    expect(dates.formatMonthWeekdayDayDashTime(d)).toBe('Mar Sun 08 - 00:30');
  });

  test('subDays, startOfDay and endOfDay', () => {
    const d = L(2026, 3, 8, 0, 30);
    expect(fmt(dates.subDays(d, 1))).toBe('2026-03-07 00:30');
    expect(fmt(dates.startOfDay(d))).toBe('2026-03-08 00:00');
    expect(dates.formatTime(dates.endOfDay(d))).toBe('23:59');
  });
});

const ZONES: Record<string, { offset: number; parseIso: string; instants: Record<string, string[]> }> = {
  'America/New_York': {
    offset: 300,
    parseIso: '2026-03-29T04:00:00.000Z',
    instants: {
      '2026-03-08T05:30:00.000Z': ['2026-03-08', 'Mar 08', 'Sun Mar 08', '00:30', 'Sun 08 00:30', 'Sun 08 - 00:30', '2026-03-08 00:30', 'Mar Sun 08 - 00:30', '2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z', '2026-03-09T04:30:00.000Z', '2026-03-07T05:30:00.000Z'],
      '2026-03-09T03:30:00.000Z': ['2026-03-08', 'Mar 08', 'Sun Mar 08', '23:30', 'Sun 08 23:30', 'Sun 08 - 23:30', '2026-03-08 23:30', 'Mar Sun 08 - 23:30', '2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z', '2026-03-10T03:30:00.000Z', '2026-03-08T04:30:00.000Z'],
      '2026-11-01T04:30:00.000Z': ['2026-11-01', 'Nov 01', 'Sun Nov 01', '00:30', 'Sun 01 00:30', 'Sun 01 - 00:30', '2026-11-01 00:30', 'Nov Sun 01 - 00:30', '2026-11-01T04:00:00.000Z', '2026-11-02T04:59:59.999Z', '2026-11-02T05:30:00.000Z', '2026-10-31T04:30:00.000Z'],
      '2026-11-02T04:30:00.000Z': ['2026-11-01', 'Nov 01', 'Sun Nov 01', '23:30', 'Sun 01 23:30', 'Sun 01 - 23:30', '2026-11-01 23:30', 'Nov Sun 01 - 23:30', '2026-11-01T04:00:00.000Z', '2026-11-02T04:59:59.999Z', '2026-11-03T04:30:00.000Z', '2026-11-01T03:30:00.000Z']
    }
  },
  'Europe/Berlin': {
    offset: -60,
    parseIso: '2026-03-28T23:00:00.000Z',
    instants: {
      '2026-03-28T23:30:00.000Z': ['2026-03-29', 'Mar 29', 'Sun Mar 29', '00:30', 'Sun 29 00:30', 'Sun 29 - 00:30', '2026-03-29 00:30', 'Mar Sun 29 - 00:30', '2026-03-28T23:00:00.000Z', '2026-03-29T21:59:59.999Z', '2026-03-29T22:30:00.000Z', '2026-03-27T23:30:00.000Z'],
      '2026-03-29T21:30:00.000Z': ['2026-03-29', 'Mar 29', 'Sun Mar 29', '23:30', 'Sun 29 23:30', 'Sun 29 - 23:30', '2026-03-29 23:30', 'Mar Sun 29 - 23:30', '2026-03-28T23:00:00.000Z', '2026-03-29T21:59:59.999Z', '2026-03-30T21:30:00.000Z', '2026-03-28T22:30:00.000Z'],
      '2026-10-24T22:30:00.000Z': ['2026-10-25', 'Oct 25', 'Sun Oct 25', '00:30', 'Sun 25 00:30', 'Sun 25 - 00:30', '2026-10-25 00:30', 'Oct Sun 25 - 00:30', '2026-10-24T22:00:00.000Z', '2026-10-25T22:59:59.999Z', '2026-10-25T23:30:00.000Z', '2026-10-23T22:30:00.000Z'],
      '2026-10-25T22:30:00.000Z': ['2026-10-25', 'Oct 25', 'Sun Oct 25', '23:30', 'Sun 25 23:30', 'Sun 25 - 23:30', '2026-10-25 23:30', 'Oct Sun 25 - 23:30', '2026-10-24T22:00:00.000Z', '2026-10-25T22:59:59.999Z', '2026-10-26T22:30:00.000Z', '2026-10-24T21:30:00.000Z']
    }
  }
};

// Node reads TZ at process start. If a child does not honor it, the zone cases cannot run.
const honored = runProbe('Europe/Berlin', []).zone === 'Europe/Berlin';
const zoneDescribe = honored ? describe : describe.skip;
const skippedName = 'zone cases (skipped: Node on this Windows runner ignores TZ in a child process)';

if (!honored && process.platform !== 'win32') {
  test('TZ is honored in a child process', () => {
    throw new Error(`TZ is not honored in a child process on ${process.platform}`);
  });
}

zoneDescribe(honored || process.platform !== 'win32' ? 'zone cases' : skippedName, () => {
  describe.each(Object.entries(ZONES))('%s', (zone, spec) => {
    const out = runProbe(zone, Object.keys(spec.instants));

    test('the child runs in the zone', () => {
      expect(out.zone).toBe(zone);
      expect(out.offset).toBe(spec.offset);
    });

    test.each(Object.entries(spec.instants))('instant %s', (iso, expected) => {
      expect(out.instants[Object.keys(spec.instants).indexOf(iso)]).toEqual(expected);
    });

    test('parseIso reads a bare day as local midnight, and new Date reads it as UTC midnight', () => {
      expect(out.local[0]).toBe(spec.parseIso);
      expect(out.local[1]).toBe('2026-03-29T00:00:00.000Z');
    });
  });
});
