import { endOfDay, startOfDay } from 'date-fns';
import { InvalidQueryError, cleanSearchTerms, parseBound, resolveProjectAlias, resolveQuery } from '../../src/core';

test('date-only to is the end of that local day', () =>
  expect(parseBound('2026-11-15', 'to')).toBe(new Date(2026, 10, 15, 23, 59, 59, 999).getTime()));
test('date-only from is the start of that local day', () =>
  expect(parseBound('2026-11-15', 'from')).toBe(startOfDay(new Date(2026, 10, 15)).getTime()));
test('a full timestamp passes through as epoch ms', () =>
  expect(parseBound('2026-11-15T10:00:00+02:00', 'to')).toBe(Date.parse('2026-11-15T08:00:00.000Z')));
test('an entry late on the to day is included', () => {
  const ts = new Date(2026, 10, 15, 23, 30).getTime();
  expect(ts <= parseBound('2026-11-15', 'to')).toBe(true);
  expect(parseBound('2026-11-15', 'to')).toBe(endOfDay(new Date(2026, 10, 15)).getTime());
});
test('invalid date names the value', () => {
  expect(() => parseBound('soon', 'from')).toThrow('Invalid date: soon');
  expect(() => parseBound('0000-01-01', 'from')).toThrow('Invalid date: 0000-01-01');
  expect(() => parseBound('garbage', 'from')).toThrow(InvalidQueryError);
});
test('alias lookup is exact first, then case-insensitive', () => {
  expect(resolveProjectAlias('Collection-App-V2', { 'collection-app-v2': 'collection-app' })).toBe('collection-app');
  expect(resolveProjectAlias('other', {})).toBe('other');
  expect(resolveProjectAlias('A', { A: 'x', a: 'y' })).toBe('x');
});
test('project resolves to the target and its alias keys', () =>
  expect(resolveQuery({ project: 'lane-b' }, { 'lane-b': 'collection-app', v2: 'collection-app' }).projects)
    .toEqual(['collection-app', 'lane-b', 'v2']));
test('text splits into terms; blank or punctuation-only text matches nothing; no text is no filter', () => {
  expect(resolveQuery({ text: '  fts   rebuild ' }, {}).terms).toEqual(['fts', 'rebuild']);
  expect(resolveQuery({ text: '   ' }, {}).terms).toEqual([]);
  expect(resolveQuery({ text: '!!' }, {}).terms).toEqual([]);
  expect(resolveQuery({}, {}).terms).toBeUndefined();
});
test('limit must be a positive integer', () => {
  expect(() => resolveQuery({ limit: 0 }, {})).toThrow('limit must be a positive integer');
  expect(() => resolveQuery({ limit: 1.5 }, {})).toThrow(InvalidQueryError);
});
test('order defaults to asc and deleted rows are excluded', () =>
  expect(resolveQuery({}, {})).toMatchObject({ order: 'asc', includeDeleted: false }));
test('empty tags mean no tag filter; kind arrays pass through', () => {
  expect(resolveQuery({ tags: [] }, {}).tags).toBeUndefined();
  expect(resolveQuery({ tags: ['a'], kind: ['done', 'next'] }, {})).toMatchObject({ tags: ['a'], kind: ['done', 'next'] });
});
test('from and to resolve to epoch ms', () => {
  const r = resolveQuery({ from: '2026-11-01', to: '2026-11-03' }, {});
  expect(r.fromMs).toBe(new Date(2026, 10, 1).getTime());
  expect(r.toMs).toBe(new Date(2026, 10, 3, 23, 59, 59, 999).getTime());
});

test('an empty kind list means no kind filter', () => {
  expect(resolveQuery({ kind: [] }, {}).kind).toBeUndefined();
  expect(resolveQuery({ kind: ['next'] }, {}).kind).toEqual(['next']);
});

test('search terms lose DEL and C1 control characters', () =>
  expect(cleanSearchTerms(['a\u007fb', 'c\u0085d', '\u009f', 'e\u0007f'])).toEqual(['ab', 'cd', 'ef']));

test('text terms drop control characters and terms with no letter or digit', () => {
  expect(resolveQuery({ text: 'a\u0000b' }, {}).terms).toEqual(['ab']);
  expect(resolveQuery({ text: 'ok " (x)' }, {}).terms).toEqual(['ok', '(x)']);
  expect(resolveQuery({ text: '\u0000' }, {}).terms).toEqual([]);
  expect(resolveQuery({ text: '"' }, {}).terms).toEqual([]);
  expect(resolveQuery({ text: '   ' }, {}).terms).toEqual([]);
  expect(resolveQuery({}, {}).terms).toBeUndefined();
});
