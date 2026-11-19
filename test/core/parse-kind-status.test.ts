import { KINDS, STATUSES, parseKind, parseStatus } from '../../src/core';

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
