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
  id: z.string().describe('Unique id of the activity item.'),
  createdAt: z.string().describe('When gournal stored the item, as an ISO timestamp.'),
  updatedAt: z.string().describe('When the item last changed, as an ISO timestamp.'),
  deletedAt: z.string().nullable().describe('When the item was deleted, or null.'),
  deviceId: z.string().describe('Id of the device that stored the item.'),
  type: z.enum(['commit', 'pr_opened', 'pr_merged', 'review']).describe('Kind of activity: a commit, an opened PR, a merged PR, or a review.'),
  occurredAt: z.string().describe('When the activity happened on GitHub, as an ISO timestamp.'),
  repo: z.string().describe('Repository (owner/name).'),
  branch: z.string().nullable().describe('Git branch of the PR, or null.'),
  externalId: z.string().describe('Id of the item on GitHub: the PR number, commit hash, or review id.'),
  title: z.string().nullable().describe('PR title or first line of the commit message, or null.'),
  url: z.string().nullable().describe('GitHub URL of the item, or null.'),
  capturedBy: z.literal('github').describe('Where the item came from. Always github.'),
  pr: z.number().nullable().describe('PR number that the item belongs to, or null.'),
  payload: z.record(z.string(), z.unknown()).describe('Extra data from GitHub, for example the review state.'),
});
export type ActivityJson = z.infer<typeof ActivitySchema>;

const LinkedActivitySchema = z.record(z.string(), z.array(ActivitySchema).describe('Activity items linked to this entry.'));

export const StandupSchema = z.object({
  title: z.string().describe('Title of the period, for example Today (2026-11-15).'),
  start: z.string().describe('Start of the period, as an ISO timestamp.'),
  end: z.string().describe('End of the period, as an ISO timestamp.'),
  isMultiDay: z.boolean().describe('True when the period covers more than one day.'),
  done: z.array(z.object({
    project: z.string().describe('Project name.'),
    entries: z.array(EntrySchema).describe('Done entries of this project in the period.'),
  })).describe('Done entries of the period, grouped by project.'),
  blockers: z.array(EntrySchema).describe('Open blockers that are not stale.'),
  next: z.array(EntrySchema).describe('Open next items that are not stale.'),
  stale: z.object({
    count: z.number().describe('Number of stale open blockers and next items.'),
    ids: z.array(z.string()).describe('Short ids (last 8 characters) of the stale entries.'),
    days: z.number().describe('Age in days after which an open item counts as stale. It comes from the staleAfterDays setting.'),
  }).describe('Open blockers and next items that are older than the stale limit.'),
  linkedActivity: LinkedActivitySchema.describe('GitHub activity that gournal linked to a done entry in this report. The key is the entry id.'),
  also: z.object({
    activity: z.array(ActivitySchema).describe('GitHub activity of the period that is not linked to a done entry in this report.'),
    counts: z.object({
      commits: z.number().describe('Number of commits.'),
      prsOpened: z.number().describe('Number of PRs opened.'),
      prsMerged: z.number().describe('Number of PRs merged.'),
      reviews: z.number().describe('Number of reviewed PRs.'),
      repos: z.number().describe('Number of repositories.'),
    }).describe('Counts of the unlinked activity.'),
  }).nullable().describe('GitHub activity of the period that is not linked to a done entry in this report, or null when there is none.'),
});
export type StandupJson = z.infer<typeof StandupSchema>;

export const WorkLogSchema = z.object({
  title: z.string().describe('Title of the period, for example Today (2026-11-15).'),
  start: z.string().describe('Start of the period, as an ISO timestamp.'),
  end: z.string().describe('End of the period, as an ISO timestamp.'),
  days: z.array(z.object({
    date: z.string().describe('Local day, as YYYY-MM-DD.'),
    entries: z.array(EntrySchema).describe('Entries of this day, oldest first.'),
  })).describe('The days of the period, oldest first.'),
  count: z.number().describe('Number of entries in the period.'),
  projectCount: z.number().describe('Number of projects that have entries in the period.'),
  linkedActivity: LinkedActivitySchema.describe('GitHub activity that gournal linked to an entry in this report. The key is the entry id.'),
});
export type WorkLogJson = z.infer<typeof WorkLogSchema>;

export const EntryListSchema = z.object({
  entries: z.array(EntrySchema).describe('The matching entries.'),
  count: z.number().describe('Number of entries returned.'),
});
export const TagCountsSchema = z.object({
  tags: z.array(z.object({
    tag: z.string().describe('Tag name.'),
    count: z.number().describe('Number of entries with this tag.'),
  })).describe('Tags, most used first.'),
});
export const ProjectCountsSchema = z.object({
  projects: z.array(z.object({
    project: z.string().describe('Project name.'),
    count: z.number().describe('Number of entries in this project.'),
  })).describe('Projects, most entries first.'),
});
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
  status: z.enum(['ok', 'partial', 'skipped', 'failed']).describe('ok: the sync finished. partial: the sync stopped early and kept what it fetched. skipped: an automatic sync did not run because another sync held the lock. Only automatic sync returns skipped. The sync_activity tool returns ok, partial, or failed. failed: the sync did not run, for example when gh is missing or signed out.'),
  since: z.string().describe('Start of the fetched window, as an ISO timestamp.'),
  inserted: z.number().describe('Number of new activity items stored.'),
  updated: z.number().describe('Number of known activity items that changed.'),
  linked: z.number().describe('Number of links that gournal made between activity items and entries.'),
  warning: z.string().nullable().describe('Why the sync stopped or failed, or null.'),
});
