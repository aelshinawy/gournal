import { z } from 'zod';
import { ActivitySchema, EntrySchema, type ActivityJson, type Activity, type Entry, type EntryJson, type StandupModel, type WorkLogModel } from '../core';

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
