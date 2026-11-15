import { extractRefs, mergeRefs } from '../../src/core';

test('extracts PR, jira, commit, and url refs', () =>
  expect(extractRefs('Shipped SBDC-1748 (PR #327), commit 5f3ee44, see https://x.io/a')).toEqual([
    { type: 'jira', value: 'SBDC-1748' }, { type: 'pr', value: '327' },
    { type: 'commit', value: '5f3ee44' }, { type: 'url', value: 'https://x.io/a' },
  ]));
test('a hex word without a digit is not a commit', () => expect(extractRefs('added a cafebabe')).toEqual([]));
test('PR url gives a pr ref with repo', () =>
  expect(extractRefs('https://github.com/acme/x/pull/473')).toContainEqual({ type: 'pr', value: '473', repo: 'acme/x' }));
test('text PR-473 is a pr ref, not jira', () =>
  expect(extractRefs('see PR-473')).toEqual([{ type: 'pr', value: '473' }]));
test('mergeRefs dedupes by type and value, keeps first', () =>
  expect(mergeRefs([{ type: 'pr', value: '1', repo: 'a/b' }], [{ type: 'pr', value: '1' }, { type: 'pr', value: '2' }])).toEqual([
    { type: 'pr', value: '1', repo: 'a/b' }, { type: 'pr', value: '2' },
  ]));
test('common tech tokens are not jira refs', () => expect(extractRefs('UTF-8 and SHA-256')).toEqual([]));
test('lowercase ticket text is not a ref', () => expect(extractRefs('sbdc-1749')).toEqual([]));
test('ticketPrefixes option limits jira refs in text', () =>
  expect(extractRefs('SBDC-1 and ABC-2', { ticketPrefixes: ['sbdc'] })).toEqual([{ type: 'jira', value: 'SBDC-1' }]));
test('repo-aware pr ref replaces the bare one', () =>
  expect(extractRefs('Opened PR #473 https://github.com/acme/x/pull/473')).toEqual([
    { type: 'pr', value: '473', repo: 'acme/x' },
    { type: 'url', value: 'https://github.com/acme/x/pull/473' },
  ]));
test('uuid segment is not a commit', () => expect(extractRefs('550e8400-e29b-41d4')).toEqual([]));
test('page#123 is not a pr', () => expect(extractRefs('page#123')).toEqual([]));
test('url trailing punctuation is trimmed', () =>
  expect(extractRefs('see (https://x.io/a).')).toEqual([{ type: 'url', value: 'https://x.io/a' }]));
