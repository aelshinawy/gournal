import { z } from 'zod';
import type { Entry, StandupModel, WorkLogModel } from '../core';

export const EntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  deviceId: z.string(),
  summary: z.string(),
  details: z.string().nullable(),
  kind: z.enum(['done', 'blocker', 'next']),
  status: z.enum(['open', 'resolved']).nullable(),
  resolvedAt: z.string().nullable(),
  resolvedByEntryId: z.string().nullable(),
  project: z.string(),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  source: z.enum(['cli', 'mcp', 'migration']),
  agent: z.string().nullable(),
  tags: z.array(z.string()),
  refs: z.array(z.object({
    type: z.enum(['pr', 'jira', 'commit', 'url']),
    value: z.string(),
    repo: z.string().optional(),
  })),
});
export type EntryJson = z.infer<typeof EntrySchema>;

export const StandupSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  isMultiDay: z.boolean(),
  done: z.array(z.object({ project: z.string(), entries: z.array(EntrySchema) })),
  blockers: z.array(EntrySchema),
  next: z.array(EntrySchema),
  stale: z.object({ count: z.number(), ids: z.array(z.string()), days: z.number() }),
});
export type StandupJson = z.infer<typeof StandupSchema>;

export const WorkLogSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.array(z.object({ date: z.string(), entries: z.array(EntrySchema) })),
  count: z.number(),
  projectCount: z.number(),
});
export type WorkLogJson = z.infer<typeof WorkLogSchema>;

export const EntryListSchema = z.object({ entries: z.array(EntrySchema), count: z.number() });
export const TagCountsSchema = z.object({ tags: z.array(z.object({ tag: z.string(), count: z.number() })) });
export const ProjectCountsSchema = z.object({ projects: z.array(z.object({ project: z.string(), count: z.number() })) });
export const EntryResultSchema = z.object({ entry: EntrySchema, notes: z.array(z.string()) });

export function entryJson(e: Entry): EntryJson {
  return { ...e, tags: [...e.tags], refs: e.refs.map((r) => ({ ...r })) };
}

export function standupJson(m: StandupModel): StandupJson {
  return {
    ...m,
    done: m.done.map((g) => ({ project: g.project, entries: g.entries.map(entryJson) })),
    blockers: m.blockers.map(entryJson),
    next: m.next.map(entryJson),
    stale: { ...m.stale, ids: [...m.stale.ids] },
  };
}

export function workLogJson(m: WorkLogModel): WorkLogJson {
  return { ...m, days: m.days.map((d) => ({ date: d.date, entries: d.entries.map(entryJson) })) };
}

export const SyncReportSchema = z.object({
  status: z.enum(['ok', 'partial', 'skipped', 'failed']),
  since: z.string(),
  inserted: z.number(),
  updated: z.number(),
  linked: z.number(),
  warning: z.string().nullable(),
});
