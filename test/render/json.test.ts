import { ActivitySchema, EntrySchema, buildStandup, buildWorkLog, resolvePeriod } from '../../src/core';
import {
  EntryListSchema, EntryResultSchema, ProjectCountsSchema, StandupSchema, TagCountsSchema,
  WorkLogSchema, entryJson, standupJson, workLogJson,
} from '../../src/render';
import { makeActivity, makeEntry } from '../core/factory';

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

  describe('activity', () => {
    const merged = makeActivity({ type: 'pr_merged', repo: 'acme/widgets', pr: 3, title: 'Cache', payload: { pr: 3, merged_at: 'x' } });
    const commit = makeActivity({ type: 'commit', repo: 'octo/app' });

    test('ActivitySchema parses an activity and rejects a bad type', () => {
      expect(ActivitySchema.parse(merged)).toEqual(merged);
      expect(() => ActivitySchema.parse({ ...merged, type: 'nope' })).toThrow();
    });

    test('standup JSON contains the full Also list and parses with StandupSchema', () => {
      const m = buildStandup({ period, done: [e], open: [], now, staleAfterDays: 14, linked: { [e.id]: [merged] }, unlinked: [merged, commit] });
      const j = standupJson(m);
      expect(StandupSchema.parse(j)).toEqual(j);
      expect(j.linkedActivity).toEqual({ [e.id]: [merged] });
      expect(j.also?.activity).toEqual([commit]);
      expect(j.also?.counts).toEqual({ commits: 1, prsOpened: 0, prsMerged: 0, reviews: 0, repos: 1 });
      expect(j).not.toHaveProperty('linked');
    });

    test('standup JSON without activity has empty linkedActivity and null also', () => {
      const j = standupJson(buildStandup({ period, done: [e], open: [], now, staleAfterDays: 14 }));
      expect(StandupSchema.parse(j)).toEqual(j);
      expect(j.linkedActivity).toEqual({});
      expect(j.also).toBeNull();
    });

    test('work log JSON carries linkedActivity', () => {
      const j = workLogJson(buildWorkLog(period, [e], { [e.id]: [merged] }));
      expect(WorkLogSchema.parse(j)).toEqual(j);
      expect(j.linkedActivity).toEqual({ [e.id]: [merged] });
      expect(j).not.toHaveProperty('linked');
    });
  });
});
