import { buildStandup, buildWorkLog, resolvePeriod } from '../../src/core';
import {
  EntryListSchema, EntryResultSchema, EntrySchema, ProjectCountsSchema, StandupSchema, TagCountsSchema,
  WorkLogSchema, entryJson, standupJson, workLogJson,
} from '../../src/render';
import { makeEntry } from '../core/factory';

const now = new Date(2026, 10, 15, 12, 0, 0);

describe('json renderers', () => {
  const e = makeEntry({
    createdAt: new Date(2026, 10, 15, 10, 30), summary: 'Shipped', details: 'd', project: 'gournal',
    tags: ['a'], refs: [{ type: 'pr', value: '1', repo: 'o/r' }, { type: 'jira', value: 'X-1' }],
  });
  const open = makeEntry({ createdAt: new Date(2026, 10, 13), kind: 'blocker', status: 'open' });
  const period = resolvePeriod({}, now, 1);

  test('entryJson validates against EntrySchema and keeps nulls', () => {
    expect(EntrySchema.parse(entryJson(e))).toEqual(entryJson(e));
    expect(entryJson(e)).toEqual(e);
    expect(entryJson(makeEntry({ createdAt: now })).deletedAt).toBeNull();
  });

  test('schemas reject bad data', () => {
    expect(() => EntrySchema.parse({ ...entryJson(e), kind: 'nope' })).toThrow();
  });

  test('standupJson validates against StandupSchema', () => {
    const m = buildStandup({ period, done: [e], open: [open], now, staleAfterDays: 14 });
    const j = standupJson(m);
    expect(StandupSchema.parse(j)).toEqual(j);
    expect(j.done[0].entries[0].summary).toBe('Shipped');
    expect(j.blockers).toHaveLength(1);
  });

  test('workLogJson validates against WorkLogSchema', () => {
    const j = workLogJson(buildWorkLog(period, [e]));
    expect(WorkLogSchema.parse(j)).toEqual(j);
    expect(j.count).toBe(1);
  });

  test('list, tag, project, and result schemas', () => {
    const j = entryJson(e);
    expect(EntryListSchema.parse({ entries: [j], count: 1 }).count).toBe(1);
    expect(TagCountsSchema.parse({ tags: [{ tag: 'a', count: 1 }] }).tags).toHaveLength(1);
    expect(ProjectCountsSchema.parse({ projects: [{ project: 'p', count: 1 }] }).projects).toHaveLength(1);
    expect(EntryResultSchema.parse({ entry: j, notes: ['n'] }).notes).toEqual(['n']);
  });
});
