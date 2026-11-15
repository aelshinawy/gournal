import { groupBy } from '../../src/core';

test('groupBy is linear and keeps order', () =>
  expect([...groupBy(['b1', 'a1', 'b2'], (s) => s[0])]).toEqual([['b', ['b1', 'b2']], ['a', ['a1']]]));
