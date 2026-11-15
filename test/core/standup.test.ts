import { buildStandup, isEmptyStandup, resolvePeriod } from '../../src/core';
import type { Activity } from '../../src/core';
import { makeActivity, makeEntry } from './factory';

const now = new Date(2026, 10, 15, 12);
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const today = resolvePeriod({}, now, 1);
const blocker = (summary: string, at: Date) => makeEntry({ summary, kind: 'blocker', status: 'open', createdAt: at });
const next = (summary: string, at: Date) => makeEntry({ summary, kind: 'next', status: 'open', createdAt: at });
const build = (open: ReturnType<typeof next>[], staleAfterDays = 14, period = today, done = [] as ReturnType<typeof next>[]) =>
  buildStandup({ period, done, open, now, staleAfterDays });

test('open items alone make a standup', () => {
  const m = build([blocker('Stuck on CI', daysAgo(2))]);
  expect(isEmptyStandup(m)).toBe(false);
  expect(m.blockers.map((e) => e.summary)).toEqual(['Stuck on CI']);
});

test('items older than staleAfterDays move to the stale line', () => {
  const old = next('Refactor X', daysAgo(15));
  const m = build([old, next('Write docs', daysAgo(3))]);
  expect(m.next.map((e) => e.summary)).toEqual(['Write docs']);
  expect(m.stale).toEqual({ count: 1, ids: [old.id.slice(-8)], days: 14 });
});

test('an item exactly staleAfterDays old is not stale', () => {
  const m = build([next('Edge', daysAgo(14))]);
  expect(m.next).toHaveLength(1);
  expect(m.stale.count).toBe(0);
});

test('open items created after the period end are left out', () => {
  const yesterday = resolvePeriod({ yesterday: true }, now, 1);
  const period = { ...yesterday, end: new Date(2026, 10, 14, 23, 59) };
  const m = build([blocker('Logged today', now)], 14, period);
  expect(m.blockers).toEqual([]);
  expect(isEmptyStandup(m)).toBe(true);
});

test('done groups by project in first-seen order', () => {
  const a1 = makeEntry({ project: 'a', createdAt: daysAgo(0) });
  const b1 = makeEntry({ project: 'b', createdAt: daysAgo(0) });
  const a2 = makeEntry({ project: 'a', createdAt: daysAgo(0) });
  const m = build([], 14, today, [a1, b1, a2]);
  expect(m.done.map((g) => g.project)).toEqual(['a', 'b']);
  expect(m.done[0].entries).toEqual([a1, a2]);
});

test('non-done entries in done and resolved or done entries in open are ignored', () => {
  const m = build(
    [makeEntry({ kind: 'blocker', status: 'resolved', createdAt: daysAgo(1) }), makeEntry({ kind: 'done', createdAt: daysAgo(1) })],
    14, today, [blocker('x', daysAgo(1))],
  );
  expect(isEmptyStandup(m)).toBe(true);
});

test('blockers and next sort oldest first, and metadata is copied', () => {
  const m = build([next('new', daysAgo(1)), next('old', daysAgo(5))]);
  expect(m.next.map((e) => e.summary)).toEqual(['old', 'new']);
  expect(m.title).toBe(today.title);
  expect(m.start).toBe(today.start.toISOString());
  expect(m.end).toBe(today.end.toISOString());
  expect(m.isMultiDay).toBe(false);
});

test('only stale items keep the standup non-empty', () => {
  const m = build([next('Ancient', daysAgo(30))]);
  expect(isEmptyStandup(m)).toBe(false);
});

describe('activity in the standup model', () => {
  const entry = makeEntry({ createdAt: new Date(2026, 10, 15, 10), summary: 'Merged PR' });
  const linkedAct = makeActivity({ type: 'pr_merged', pr: 4, title: 'Phase 2 layers' });
  const freeAct = makeActivity({ type: 'commit' });
  const withActivity = (over: { linked?: Record<string, Activity[]>; unlinked?: Activity[] }, done = [entry]) =>
    buildStandup({ period: today, done, open: [], now, staleAfterDays: 14, ...over });

  test('without activity input, linked is empty and also is null', () => {
    const m = build([]);
    expect(m.linked).toEqual({});
    expect(m.also).toBeNull();
  });

  test('standup with only unlinked activity is not empty', () => {
    const m = withActivity({ unlinked: [freeAct] }, []);
    expect(m.also).not.toBeNull();
    expect(isEmptyStandup(m)).toBe(false);
  });

  test('linked activity is not in Also', () => {
    const m = withActivity({ linked: { [entry.id]: [linkedAct] }, unlinked: [linkedAct, freeAct] });
    expect(m.linked[entry.id]).toEqual([linkedAct]);
    expect(m.also?.activity).toEqual([freeAct]);
    expect(m.also?.counts).toMatchObject({ commits: 1, prsMerged: 0 });
  });

  test('Also is null when every unlinked item is linked', () => {
    const m = withActivity({ linked: { [entry.id]: [linkedAct] }, unlinked: [linkedAct] });
    expect(m.also).toBeNull();
  });
});
