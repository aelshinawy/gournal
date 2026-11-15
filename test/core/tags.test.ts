import { normalizeTags, closeTags } from '../../src/core';

test('normalizes case, whitespace, and spaces', () =>
  expect(normalizeTags([' Code Review ', 'PR', 'pr']).tags).toEqual(['code-review', 'pr']));
test('applies aliases after normalizing', () =>
  expect(normalizeTags(['Specs', 'gamedev'], { specs: 'spec', gamedev: 'game-dev' }).tags).toEqual(['spec', 'game-dev']));
test('ticket-like tags become uppercase jira refs', () =>
  expect(normalizeTags(['sbdc-1749', 'SBDC-1750', 'step-4'])).toEqual({
    tags: ['step-4'],
    refs: [{ type: 'jira', value: 'SBDC-1749' }, { type: 'jira', value: 'SBDC-1750' }],
  }));
test('pr-prefixed tag becomes a pr ref', () =>
  expect(normalizeTags(['PR-473'])).toEqual({ tags: [], refs: [{ type: 'pr', value: '473' }] }));
test('drops empty tags', () => expect(normalizeTags(['', '  ']).tags).toEqual([]));
test('closeTags suggests near variants', () =>
  expect(closeTags('reveiw', ['review', 'code-review', 'refactor', 'godot'])).toEqual(['review']));
test('closeTags is empty for an existing tag', () => expect(closeTags('review', ['review'])).toEqual([]));
