import { checkSummary, splitSummary, summaryLength } from '../../src/core';

test('limit counts code points', () => {
  const s = 'a'.repeat(119) + '🙂';
  expect(summaryLength(s)).toBe(120);
  expect(checkSummary(s, null, { allowSplit: false }).ok).toBe(true);
  expect(checkSummary(s + 'b', null, { allowSplit: false }).ok).toBe(false);
});
test('rejection states length, limit, and fix', () => {
  const r = checkSummary('x'.repeat(340), null, { allowSplit: false });
  expect(r).toEqual({ ok: false, error: 'summary is 340 chars, max 120. Put one line in summary and the rest in details.' });
});
test('split uses the first sentence and keeps the full text in details', () => {
  const text = 'Shipped SBDC-1748. Scoped the ranking and dropped a join.';
  expect(splitSummary(text)).toEqual({ summary: 'Shipped SBDC-1748.', details: text });
});
test('split cuts a long first sentence at a word boundary with an ellipsis', () => {
  const r = splitSummary('word '.repeat(60).trim());
  expect(summaryLength(r.summary)).toBeLessThanOrEqual(120);
  expect(r.summary.endsWith('...')).toBe(true);
  expect(r.summary).not.toMatch(/ \.\.\.$/);
});
test('a short text is not split', () => expect(splitSummary('Fixed it')).toEqual({ summary: 'Fixed it', details: null }));
test('allowSplit splits instead of rejecting and prepends to existing details', () => {
  const r = checkSummary('A. ' + 'b'.repeat(200), 'extra', { allowSplit: true });
  expect(r).toEqual({ ok: true, summary: 'A.', details: 'A. ' + 'b'.repeat(200) + '\n\nextra' });
});

test('a summary with a newline is over the limit when splitting is off', () => {
  expect(checkSummary('Line one\nLine two', null, { allowSplit: false })).toEqual({
    ok: false, error: 'summary must be one line, max 120. Put the rest in details.' });
  expect(checkSummary('Line one\r\nLine two', null, { allowSplit: false }).ok).toBe(false);
});
test('a summary with a newline splits at the first line when splitting is on', () => {
  expect(checkSummary('Line one\nLine two', null, { allowSplit: true })).toEqual({
    ok: true, summary: 'Line one', details: 'Line one\nLine two' });
  expect(checkSummary('Line one\nLine two', 'extra', { allowSplit: true })).toEqual({
    ok: true, summary: 'Line one', details: 'Line one\nLine two\n\nextra' });
});
test('a newline only at the end is not a second line', () => {
  expect(checkSummary('Line one\n', null, { allowSplit: false })).toEqual({ ok: true, summary: 'Line one', details: null });
});

describe.each([['CR', '\r'], ['LF', '\n'], ['U+2028', '\u2028'], ['U+2029', '\u2029']])('line break %s', (_name, br) => {
  test('checkSummary rejects it as a second line', () => {
    expect(checkSummary(`Line one${br}Line two`, null, { allowSplit: false }).ok).toBe(false);
  });
  test('splitting cuts the summary at it and keeps the full text in details', () => {
    expect(checkSummary(`Line one${br}Line two`, null, { allowSplit: true })).toEqual({
      ok: true, summary: 'Line one', details: `Line one${br}Line two` });
    expect(splitSummary(`Line one${br}Line two`)).toEqual({ summary: 'Line one', details: `Line one${br}Line two` });
  });
});
