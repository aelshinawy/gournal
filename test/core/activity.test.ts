import { activityCounts, summarizeLinked } from '../../src/core';
import { makeActivity as a } from './factory';

test('counts reviews by distinct PR and repos by distinct repo', () => {
  const list = [
    a({ type: 'review', repo: 'acme/widgets', pr: 5 }), a({ type: 'review', repo: 'acme/widgets', pr: 5 }),
    a({ type: 'review', repo: 'acme/widgets', pr: 5 }), a({ type: 'review', repo: 'octo/app', pr: 9 }),
    a({ type: 'commit', repo: 'acme/widgets' }), a({ type: 'commit', repo: 'acme/widgets' }),
  ];
  expect(activityCounts(list)).toEqual({ commits: 2, prsOpened: 0, prsMerged: 0, reviews: 2, repos: 2 });
});

test('counts opened and merged PRs', () => {
  const list = [a({ type: 'pr_opened', pr: 1 }), a({ type: 'pr_merged', pr: 1 }), a({ type: 'pr_opened', pr: 2 })];
  expect(activityCounts(list)).toMatchObject({ prsOpened: 2, prsMerged: 1, repos: 1 });
});

test('summarizeLinked keeps the most advanced event per PR and counts commits', () => {
  const list = [
    a({ type: 'pr_merged', repo: 'acme/widgets', pr: 5, title: 'Five', occurredAt: '2026-11-11T12:00:00.000Z' }),
    a({ type: 'pr_opened', repo: 'acme/widgets', pr: 5, title: 'Five', occurredAt: '2026-11-11T09:00:00.000Z' }),
    a({ type: 'review', repo: 'octo/app', pr: 9, title: 'Nine', occurredAt: '2026-11-11T10:00:00.000Z' }),
    a({ type: 'commit' }), a({ type: 'commit' }), a({ type: 'commit' }),
  ];
  expect(summarizeLinked(list)).toEqual({
    prs: [
      { repo: 'acme/widgets', pr: 5, title: 'Five', event: 'merged' },
      { repo: 'octo/app', pr: 9, title: 'Nine', event: 'reviewed' },
    ],
    commits: 3,
  });
});

test('summarizeLinked ranks events, not recency, and orders PRs by first occurrence', () => {
  const list = [
    a({ type: 'review', repo: 'acme/widgets', pr: 7, title: 'Seven', occurredAt: '2026-11-11T11:00:00.000Z' }),
    a({ type: 'pr_opened', repo: 'acme/gears', pr: 3, title: 'Three', occurredAt: '2026-11-11T08:00:00.000Z' }),
    a({ type: 'pr_merged', repo: 'acme/widgets', pr: 7, title: 'Seven', occurredAt: '2026-11-11T10:00:00.000Z' }),
  ];
  expect(summarizeLinked(list).prs).toEqual([
    { repo: 'acme/gears', pr: 3, title: 'Three', event: 'opened' },
    { repo: 'acme/widgets', pr: 7, title: 'Seven', event: 'merged' },
  ]);
});

test('activityCounts repo keys ignore case', () => {
  expect(activityCounts([a({ repo: 'Acme/Widgets' }), a({ repo: 'acme/widgets' })]).repos).toBe(1);
});
