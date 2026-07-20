import { filterByProject, filterByTags, groupByProject } from '../src/util/entries.util';
import { Entry } from '../src/types';

const entries: Entry[] = [
  { timestamp: '2026-07-13T10:00:00.000Z', message: 'Fixed auth middleware', project: 'api', tags: ['bug'] },
  { timestamp: '2026-07-13T11:00:00.000Z', message: 'Updated Docker config', project: 'infra', tags: [] },
  { timestamp: '2026-07-14T09:00:00.000Z', message: 'Added retries', project: 'api', tags: ['bug', 'reliability'] },
];

describe('filterByProject', () => {
  test('returns all entries when no project given', () => {
    expect(filterByProject(entries, undefined)).toEqual(entries);
  });

  test('filters to a single project', () => {
    expect(filterByProject(entries, 'infra')).toEqual([entries[1]]);
  });
});

describe('filterByTags', () => {
  test('returns all entries when no tags given', () => {
    expect(filterByTags(entries, undefined)).toEqual(entries);
  });

  test('requires every given tag to be present (AND semantics)', () => {
    expect(filterByTags(entries, ['bug', 'reliability'])).toEqual([entries[2]]);
  });

  test('returns nothing when a tag is missing', () => {
    expect(filterByTags(entries, ['nonexistent'])).toEqual([]);
  });
});

describe('groupByProject', () => {
  test('groups entries into a Map keyed by project, preserving order', () => {
    const grouped = groupByProject(entries);
    expect(Array.from(grouped.keys())).toEqual(['api', 'infra']);
    expect(grouped.get('api')).toEqual([entries[0], entries[2]]);
    expect(grouped.get('infra')).toEqual([entries[1]]);
  });
});
