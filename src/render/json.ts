import { z } from 'zod';
import type { Activity, Entry, StandupModel, WorkLogModel } from '../core';

export const EntrySchema = z.object({
  id: z.string().describe('Unique id of the entry. The last 8 characters work as a short id.'),
  createdAt: z.string().describe('When the entry was created, as an ISO timestamp.'),
  updatedAt: z.string().describe('When the entry last changed, as an ISO timestamp.'),
  deletedAt: z.string().nullable().describe('When the entry was deleted, or null if it is not deleted.'),
  deviceId: z.string().describe('Id of the device that created the entry.'),
  summary: z.string().describe('One line that says what happened.'),
  details: z.string().nullable().describe('Longer text for the entry, or null.'),
  kind: z.enum(['done', 'blocker', 'next']).describe('done, blocker (something stops you), or next (a planned step).'),
  status: z.enum(['open', 'resolved']).nullable().describe('open or resolved for a blocker or next entry. Null for a done entry.'),
  resolvedAt: z.string().nullable().describe('When the entry was resolved, or null.'),
  resolvedByEntryId: z.string().nullable().describe('Id of the entry that resolved this one, or null.'),
  project: z.string().describe('Project name.'),
  repo: z.string().nullable().describe('Repository (owner/name), or null.'),
  branch: z.string().nullable().describe('Git branch, or null.'),
  source: z.enum(['cli', 'mcp', 'migration']).describe('Where the entry came from: the CLI, the MCP server, or a migration.'),
  agent: z.string().nullable().describe('Name of the agent that logged the entry, or null.'),
  tags: z.array(z.string()).describe('Tags of the entry.'),
  refs: z.array(z.object({
    type: z.enum(['pr', 'jira', 'commit', 'url']).describe('Kind of reference.'),
    value: z.string().describe('The PR number, ticket key, commit hash, or URL.'),
    repo: z.string().optional().describe('Repository (owner/name) of the reference.'),
  })).describe('References such as PRs and ticket keys.'),
});
export type EntryJson = z.infer<typeof EntrySchema>;

export const ActivitySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  deviceId: z.string(),
  type: z.enum(['commit', 'pr_opened', 'pr_merged', 'review']),
  occurredAt: z.string(),
  repo: z.string(),
  branch: z.string().nullable(),
  externalId: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  capturedBy: z.literal('github'),
  pr: z.number().nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export type ActivityJson = z.infer<typeof ActivitySchema>;

const LinkedActivitySchema = z.record(z.string(), z.array(ActivitySchema));

export const StandupSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  isMultiDay: z.boolean(),
  done: z.array(z.object({ project: z.string(), entries: z.array(EntrySchema) })),
  blockers: z.array(EntrySchema),
  next: z.array(EntrySchema),
  stale: z.object({ count: z.number(), ids: z.array(z.string()), days: z.number() }),
  linkedActivity: LinkedActivitySchema,
  also: z.object({
    activity: z.array(ActivitySchema),
    counts: z.object({ commits: z.number(), prsOpened: z.number(), prsMerged: z.number(), reviews: z.number(), repos: z.number() }),
  }).nullable(),
});
export type StandupJson = z.infer<typeof StandupSchema>;

export const WorkLogSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.array(z.object({ date: z.string(), entries: z.array(EntrySchema) })),
  count: z.number(),
  projectCount: z.number(),
  linkedActivity: LinkedActivitySchema,
});
export type WorkLogJson = z.infer<typeof WorkLogSchema>;

export const EntryListSchema = z.object({
  entries: z.array(EntrySchema).describe('The matching entries.'),
  count: z.number().describe('Number of entries returned.'),
});
export const TagCountsSchema = z.object({ tags: z.array(z.object({ tag: z.string(), count: z.number() })) });
export const ProjectCountsSchema = z.object({ projects: z.array(z.object({ project: z.string(), count: z.number() })) });
export const EntryResultSchema = z.object({
  entry: EntrySchema.describe('The entry after the change.'),
  notes: z.array(z.string()).describe('Hints and warnings, for example a close tag name or an id that could not be resolved.'),
});

export function entryJson(e: Entry): EntryJson {
  return { ...e, tags: [...e.tags], refs: e.refs.map((r) => ({ ...r })) };
}

const activityJson = (a: Activity): ActivityJson => ({ ...a, payload: { ...a.payload } });
const linkedJson = (linked: Record<string, Activity[]>): Record<string, ActivityJson[]> =>
  Object.fromEntries(Object.entries(linked).map(([id, list]) => [id, list.map(activityJson)]));

export function standupJson(m: StandupModel): StandupJson {
  const { linked, also, ...rest } = m;
  return {
    ...rest,
    done: m.done.map((g) => ({ project: g.project, entries: g.entries.map(entryJson) })),
    blockers: m.blockers.map(entryJson),
    next: m.next.map(entryJson),
    stale: { ...m.stale, ids: [...m.stale.ids] },
    linkedActivity: linkedJson(linked),
    also: also ? { activity: also.activity.map(activityJson), counts: { ...also.counts } } : null,
  };
}

export function workLogJson(m: WorkLogModel): WorkLogJson {
  const { linked, ...rest } = m;
  return { ...rest, days: m.days.map((d) => ({ date: d.date, entries: d.entries.map(entryJson) })), linkedActivity: linkedJson(linked) };
}

export const SyncReportSchema = z.object({
  status: z.enum(['ok', 'partial', 'skipped', 'failed']),
  since: z.string(),
  inserted: z.number(),
  updated: z.number(),
  linked: z.number(),
  warning: z.string().nullable(),
});
