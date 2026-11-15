import { subDays } from 'date-fns';
import { buildStats, shortId } from '../../src/core';
import { makeEntry } from './factory';

const now = new Date(2026, 10, 15, 12);
const at = (d: Date, project = 'api', tags: string[] = []) => makeEntry({ createdAt: d, project, tags });

test('shortId is the last 8 chars', () => {
  expect(shortId('0123456789ABCDEF')).toBe('89ABCDEF');
});

test('counts total and groups by project and tag, sorted by count then name', () => {
  const m = buildStats([at(now, 'api', ['bug']), at(now, 'api', ['bug', 'a']), at(now, 'infra'), at(now, 'aaa')], now);
  expect(m.total).toBe(4);
  expect(m.byProject).toEqual([['api', 2], ['aaa', 1], ['infra', 1]]);
  expect(m.byTag).toEqual([['bug', 2], ['a', 1]]);
});

test('stats streak counts back from today or yesterday', () => {
  expect(buildStats([at(now), at(subDays(now, 1)), at(subDays(now, 2))], now).streak).toBe(3);
  expect(buildStats([at(subDays(now, 1))], now).streak).toBe(1);
  expect(buildStats([at(subDays(now, 3))], now).streak).toBe(0);
  expect(buildStats([], now)).toEqual({ total: 0, streak: 0, byProject: [], byTag: [] });
});
