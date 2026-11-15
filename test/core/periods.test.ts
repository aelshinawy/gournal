import { resolvePeriod } from '../../src/core';

test('week starts on the configured day', () => {
  const now = new Date(2026, 10, 15, 12); // Sunday
  expect(resolvePeriod({ week: true }, now, 1).start).toEqual(new Date(2026, 10, 9));
  expect(resolvePeriod({ week: true }, now, 1).title).toBe('Weekly (Nov 09 - Nov 15)');
  expect(resolvePeriod({ week: true }, now, 0).start).toEqual(new Date(2026, 10, 15));
});
test('from and to win over the flags', () => {
  const p = resolvePeriod({ week: true, from: '2026-11-01', to: '2026-11-03' }, new Date(2026, 10, 15), 1);
  expect(p).toMatchObject({ name: 'range', title: 'Range (2026-11-01 - 2026-11-03)', isMultiDay: true });
  expect(p.end).toEqual(new Date(2026, 10, 3, 23, 59, 59, 999));
});
test('to without from covers that one day', () => {
  const p = resolvePeriod({ to: '2026-11-03' }, new Date(2026, 10, 15), 1);
  expect(p.name).toBe('range');
  expect(p.start).toEqual(new Date(2026, 10, 3));
  expect(p.end).toEqual(new Date(2026, 10, 3, 23, 59, 59, 999));
  expect(p.isMultiDay).toBe(false);
});
test('from alone ends at now', () => {
  const now = new Date(2026, 10, 15, 9);
  const p = resolvePeriod({ from: '2026-11-10' }, now, 1);
  expect(p.start).toEqual(new Date(2026, 10, 10));
  expect(p.end).toEqual(now);
});
test('today keeps its title', () => {
  const p = resolvePeriod({}, new Date(2026, 10, 15, 9), 1);
  expect(p.title).toBe('Today (2026-11-15)');
  expect(p.name).toBe('today');
  expect(p.start).toEqual(new Date(2026, 10, 15));
  expect(p.isMultiDay).toBe(false);
});
test('yesterday and month', () => {
  const now = new Date(2026, 10, 15, 9);
  const y = resolvePeriod({ yesterday: true }, now, 1);
  expect(y.title).toBe('Yesterday (Nov 14 → Nov 15)');
  expect(y.start).toEqual(new Date(2026, 10, 14));
  const m = resolvePeriod({ month: true, week: true }, now, 1);
  expect(m.name).toBe('month');
  expect(m.title).toBe('Monthly (Nov 01 - Nov 15)');
  expect(m.start).toEqual(new Date(2026, 10, 1));
});
