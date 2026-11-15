import { buildWorkLog, resolvePeriod } from '../../src/core';
import { makeEntry } from './factory';

const now = new Date(2026, 10, 15, 12);
const week = resolvePeriod({ week: true }, now, 1);

test('work log days use the local date', () => {
  const late = makeEntry({ createdAt: new Date(2026, 10, 14, 23, 30) });
  const m = buildWorkLog(week, [late]);
  expect(m.days.map((d) => d.date)).toEqual(['2026-11-14']);
});

test('days ascend, entries ascend within a day, outside entries drop, counts are set', () => {
  const e1 = makeEntry({ project: 'a', createdAt: new Date(2026, 10, 15, 9) });
  const e2 = makeEntry({ project: 'b', createdAt: new Date(2026, 10, 13, 15) });
  const e3 = makeEntry({ project: 'a', createdAt: new Date(2026, 10, 13, 8) });
  const out = makeEntry({ createdAt: new Date(2026, 10, 1, 8) });
  const m = buildWorkLog(week, [e1, e2, e3, out]);
  expect(m.days.map((d) => d.date)).toEqual(['2026-11-13', '2026-11-15']);
  expect(m.days[0].entries).toEqual([e3, e2]);
  expect(m.count).toBe(3);
  expect(m.projectCount).toBe(2);
  expect(m.title).toBe(week.title);
});
