import { matchLinks } from '../../src/core';
import { makeActivity as a, makeEntry as e } from './factory';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const run = (entries: ReturnType<typeof e>[], activity: ReturnType<typeof a>[]) =>
  matchLinks({ entries, activity, weekStartsOn: 1 });

test('pr-match links an entry ref to PR activity in the same repo', () => {
  const entry = e({ createdAt: at(2026, 11, 11), repo: 'acme/widgets', refs: [{ type: 'pr', value: '327' }] });
  const merged = a({ type: 'pr_merged', repo: 'acme/widgets', pr: 327 });
  const other = a({ type: 'pr_merged', repo: 'acme/gears', pr: 327 });
  expect(run([entry], [merged, other])).toEqual([{ entryId: entry.id, activityId: merged.id, reason: 'pr-match' }]);
});

test('pr-match strips a leading hash', () => {
  const entry = e({ createdAt: at(2026, 11, 11), repo: 'acme/widgets', refs: [{ type: 'pr', value: '#327' }] });
  const merged = a({ type: 'pr_merged', repo: 'acme/widgets', pr: 327 });
  expect(run([entry], [merged])).toHaveLength(1);
});

test('pr-match uses the ref repo before the entry repo', () => {
  const entry = e({ createdAt: at(2026, 11, 11), repo: 'acme/widgets', refs: [{ type: 'pr', value: '5', repo: 'acme/gears' }] });
  const widgets = a({ type: 'pr_opened', repo: 'acme/widgets', pr: 5 });
  const gears = a({ type: 'pr_opened', repo: 'acme/gears', pr: 5 });
  expect(run([entry], [widgets, gears])).toEqual([{ entryId: entry.id, activityId: gears.id, reason: 'pr-match' }]);
});

test('pr-match links every activity of that PR', () => {
  const entry = e({ createdAt: at(2026, 11, 11), repo: 'acme/widgets', refs: [{ type: 'pr', value: '5' }] });
  const list = [a({ type: 'pr_opened', repo: 'acme/widgets', pr: 5 }), a({ type: 'commit', repo: 'acme/widgets', pr: 5 }), a({ type: 'review', repo: 'acme/widgets', pr: 5 })];
  expect(run([entry], list).map((l) => l.activityId).sort()).toEqual(list.map((x) => x.id).sort());
});

test('pr-match without a repo links only when one synced repo has that PR in the entry week', () => {
  const entry = e({ createdAt: at(2026, 11, 11), refs: [{ type: 'pr', value: '12' }] });
  const widgets = a({ type: 'pr_merged', repo: 'acme/widgets', pr: 12, occurredAt: at(2026, 11, 10) });
  expect(run([entry], [widgets])).toEqual([{ entryId: entry.id, activityId: widgets.id, reason: 'pr-match' }]);
  const octo = a({ type: 'pr_merged', repo: 'octo/app', pr: 12, occurredAt: at(2026, 11, 12) });
  expect(run([entry], [widgets, octo])).toEqual([]);
  const octoLastWeek = a({ type: 'pr_merged', repo: 'octo/app', pr: 12, occurredAt: at(2026, 11, 2) });
  expect(run([entry], [widgets, octoLastWeek])).toEqual([{ entryId: entry.id, activityId: widgets.id, reason: 'pr-match' }]);
});

test('week boundary honours weekStartsOn', () => {
  const entry = e({ createdAt: at(2026, 11, 15), refs: [{ type: 'pr', value: '12' }] }); // Sunday
  const act = a({ type: 'pr_merged', repo: 'acme/widgets', pr: 12, occurredAt: at(2026, 11, 9) }); // Monday
  expect(matchLinks({ entries: [entry], activity: [act], weekStartsOn: 1 })).toHaveLength(1);
  expect(matchLinks({ entries: [entry], activity: [act], weekStartsOn: 0 })).toEqual([]);
});

test('sha-match needs 7 or more hex characters and exactly one commit', () => {
  const short = e({ createdAt: at(2026, 11, 11), refs: [{ type: 'commit', value: 'abc12' }] });
  const ok = e({ createdAt: at(2026, 11, 11), refs: [{ type: 'commit', value: 'abc1234' }] });
  const c1 = a({ type: 'commit', externalId: 'abc1234ff00000000000000000000000000000aa' });
  expect(run([short], [c1])).toEqual([]);
  expect(run([ok], [c1])).toEqual([{ entryId: ok.id, activityId: c1.id, reason: 'sha-match' }]);
  const c2 = a({ type: 'commit', externalId: 'abc1234ee00000000000000000000000000000bb' });
  expect(run([ok], [c1, c2])).toEqual([]);
});

test('branch-window links only when exactly one done entry is within 2 hours', () => {
  const commit = a({ type: 'commit', repo: 'acme/widgets', branch: 'feat/x', occurredAt: at(2026, 11, 11, 10) });
  const mk = (h: number, min = 0, kind: 'done' | 'next' = 'done') =>
    e({ createdAt: at(2026, 11, 11, h, min), repo: 'acme/widgets', branch: 'feat/x', kind });
  const near = mk(11, 59);
  expect(run([near], [commit])).toEqual([{ entryId: near.id, activityId: commit.id, reason: 'branch-window' }]);
  expect(run([near, mk(9)], [commit])).toEqual([]);
  expect(run([near, mk(10, 30, 'next')], [commit])).toHaveLength(1);
  expect(run([mk(12, 1)], [commit])).toEqual([]);
});

test('branch-window needs the same branch', () => {
  const commit = a({ type: 'commit', repo: 'acme/widgets', branch: 'feat/x', occurredAt: at(2026, 11, 11, 10) });
  const entry = e({ createdAt: at(2026, 11, 11, 10, 30), repo: 'acme/widgets', branch: 'feat/y' });
  expect(run([entry], [commit])).toEqual([]);
});

test('repo match ignores case', () => {
  const entry = e({ createdAt: at(2026, 11, 11), repo: 'Acme/Widgets', refs: [{ type: 'pr', value: '1' }] });
  expect(run([entry], [a({ type: 'pr_merged', repo: 'acme/widgets', pr: 1 })])).toHaveLength(1);
});

test('no link on text similarity', () => {
  const entry = e({ createdAt: at(2026, 11, 11), summary: 'Merged PR #327', refs: [] });
  expect(run([entry], [a({ type: 'pr_merged', repo: 'acme/widgets', pr: 327 })])).toEqual([]);
});

test('deleted entries and deleted activity never link', () => {
  const del = new Date().toISOString();
  const entry = e({ createdAt: at(2026, 11, 11), repo: 'acme/widgets', refs: [{ type: 'pr', value: '1' }] });
  const gone = e({ createdAt: at(2026, 11, 11), repo: 'acme/widgets', refs: [{ type: 'pr', value: '1' }], deletedAt: del });
  const live = a({ type: 'pr_merged', repo: 'acme/widgets', pr: 1 });
  const dead = a({ type: 'pr_merged', repo: 'acme/widgets', pr: 1, deletedAt: del });
  expect(run([gone], [live])).toEqual([]);
  expect(run([entry], [dead])).toEqual([]);
});

test('pr-match wins when one pair matches two rules', () => {
  const entry = e({
    createdAt: at(2026, 11, 11, 10), repo: 'acme/widgets', branch: 'feat/x',
    refs: [{ type: 'pr', value: '9' }, { type: 'commit', value: 'abc1234' }],
  });
  const c = a({ type: 'commit', repo: 'acme/widgets', branch: 'feat/x', pr: 9, externalId: 'abc1234ff', occurredAt: at(2026, 11, 11, 10) });
  expect(run([entry], [c])).toEqual([{ entryId: entry.id, activityId: c.id, reason: 'pr-match' }]);
});

test('sha-match does not link into another repo when the entry has a repo', () => {
  const entry = e({ createdAt: at(2026, 11, 11), repo: 'acme/widgets', refs: [{ type: 'commit', value: 'abc1234' }] });
  expect(run([entry], [a({ type: 'commit', repo: 'acme/gears', externalId: 'abc1234ff' })])).toEqual([]);
});

test('sha-match links across repos when the entry has no repo', () => {
  const entry = e({ createdAt: at(2026, 11, 11), refs: [{ type: 'commit', value: 'abc1234' }] });
  const c = a({ type: 'commit', repo: 'acme/gears', externalId: 'abc1234ff' });
  expect(run([entry], [c])).toEqual([{ entryId: entry.id, activityId: c.id, reason: 'sha-match' }]);
});

test('sha-match ignores a non-hex ref', () => {
  const entry = e({ createdAt: at(2026, 11, 11), refs: [{ type: 'commit', value: 'zzzzzzz' }] });
  expect(run([entry], [a({ type: 'commit', externalId: 'zzzzzzzff' })])).toEqual([]);
});

test('sha-match ignores case', () => {
  const entry = e({ createdAt: at(2026, 11, 11), refs: [{ type: 'commit', value: 'ABC1234' }] });
  expect(run([entry], [a({ type: 'commit', externalId: 'abc1234ff' })])).toHaveLength(1);
});

test('branch-window links at exactly 2 hours', () => {
  const commit = a({ type: 'commit', repo: 'acme/widgets', branch: 'feat/x', occurredAt: at(2026, 11, 11, 10) });
  const entry = e({ createdAt: at(2026, 11, 11, 12), repo: 'acme/widgets', branch: 'feat/x' });
  expect(run([entry], [commit])).toHaveLength(1);
});
