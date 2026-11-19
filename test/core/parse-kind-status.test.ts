import { KINDS, STATUSES, NOT_RESOLVABLE, canResolve, noEntryMessage, parseKind, parseStatus } from '../../src/core';

test('parseKind returns each known kind', () => {
  for (const k of KINDS) expect(parseKind(k)).toBe(k);
});
test('parseKind rejects an unknown kind with the usage message', () => {
  expect(() => parseKind('later')).toThrow(new Error('Unknown kind "later". Use done, blocker, or next.'));
  expect(() => parseKind('')).toThrow('Unknown kind "".');
  expect(() => parseKind('DONE')).toThrow('Unknown kind "DONE".');
});
test('parseStatus returns each known status', () => {
  for (const s of STATUSES) expect(parseStatus(s)).toBe(s);
});
test('parseStatus rejects an unknown status with the usage message', () => {
  expect(() => parseStatus('closed')).toThrow(new Error('Unknown status "closed". Use open or resolved.'));
  expect(() => parseStatus('')).toThrow('Unknown status "".');
});
test('canResolve is true only for an open blocker or next', () => {
  expect(canResolve('blocker', 'open')).toBe(true);
  expect(canResolve('next', 'open')).toBe(true);
  expect(canResolve('blocker', 'resolved')).toBe(false);
  expect(canResolve('done', null)).toBe(false);
  expect(canResolve(null, 'open')).toBe(false);
});
test('the resolve error strings keep their wording', () => {
  expect(NOT_RESOLVABLE).toBe('only an open blocker or next can be resolved');
  expect(noEntryMessage('ZZZZZZZZ')).toBe('No entry with id "ZZZZZZZZ"');
});
