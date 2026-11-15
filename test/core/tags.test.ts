import { normalizeTags, closeTags } from '../../src/core';

test('normalizes case, whitespace, and spaces', () =>
  expect(normalizeTags([' Code Review ', 'PR', 'pr']).tags).toEqual(['code-review', 'pr']));
test('applies aliases after normalizing', () =>
  expect(normalizeTags(['Specs', 'gamedev'], { specs: 'spec', gamedev: 'game-dev' }).tags).toEqual(['spec', 'game-dev']));
test('ticket-like tags become uppercase jira refs', () =>
  expect(normalizeTags(['sbdc-1749', 'SBDC-1750', 'step-4'], {}, { ticketPrefixes: ['SBDC'] })).toEqual({
    tags: ['step-4'],
    refs: [{ type: 'jira', value: 'SBDC-1749' }, { type: 'jira', value: 'SBDC-1750' }],
  }));
test('pr-prefixed tag becomes a pr ref', () =>
  expect(normalizeTags(['PR-473'])).toEqual({ tags: [], refs: [{ type: 'pr', value: '473' }] }));
test('drops empty tags', () => expect(normalizeTags(['', '  ']).tags).toEqual([]));
test('closeTags suggests near variants', () =>
  expect(closeTags('reveiw', ['review', 'code-review', 'refactor', 'godot'])).toEqual(['review']));
test('closeTags is empty for an existing tag', () => expect(closeTags('review', ['review'])).toEqual([]));
test('non-ticket prefixes stay tags', () =>
  expect(normalizeTags(['sprint-12', 'node-22', 'ios-17', 'gpt-4', 'utf-8'])).toEqual({
    tags: ['sprint-12', 'node-22', 'ios-17', 'gpt-4', 'utf-8'],
    refs: [],
  }));
test('ticketPrefixes limits which prefixes are tickets', () =>
  expect(normalizeTags(['sbdc-1749', 'abc-12'], {}, { ticketPrefixes: ['SBDC'] })).toEqual({
    tags: ['abc-12'],
    refs: [{ type: 'jira', value: 'SBDC-1749' }],
  }));
test('aliases ignore the prototype chain', () =>
  expect(normalizeTags(['constructor', '__proto__']).tags).toEqual(['constructor', '__proto__']));
test('closeTags ignores short tags for distance', () => expect(closeTags('ci', ['pr', 'ui'])).toEqual([]));
test('without ticketPrefixes, ticket-shaped tags stay tags', () =>
  expect(normalizeTags(['sbdc-1749', 'task-1', 'world-2'])).toEqual({ tags: ['sbdc-1749', 'task-1', 'world-2'], refs: [] }));
test('with ticketPrefixes, only matching tags convert', () =>
  expect(normalizeTags(['sbdc-1749', 'SBDC-1750', 'task-1'], {}, { ticketPrefixes: ['SBDC'] })).toEqual({
    tags: ['task-1'],
    refs: [{ type: 'jira', value: 'SBDC-1749' }, { type: 'jira', value: 'SBDC-1750' }],
  }));
test('pr-N tags always become pr refs', () =>
  expect(normalizeTags(['pr-401'])).toEqual({ tags: [], refs: [{ type: 'pr', value: '401' }] }));
