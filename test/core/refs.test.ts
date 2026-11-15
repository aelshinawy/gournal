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
