import { buildStandup, buildWorkLog, filterActivity, resolvePeriod } from '../core';
import type { Query, StandupModel, WorkLogModel } from '../core';
import type { Journal } from '../storage';

export interface ReportOptions {
  yesterday?: boolean; week?: boolean; month?: boolean;
  from?: string; to?: string;
  project?: string; repo?: string; tags?: string[];
}

type ReportJournal = Pick<Journal, 'repo' | 'activity' | 'config'>;

/** The filters that do not depend on the period. The period owns the date bounds. */
function baseQuery(opts: ReportOptions): Query {
  return { project: opts.project, repo: opts.repo, tags: opts.tags };
}

/**
 * Done entries use the period bounds. Open blockers and next items use only the end bound,
 * so older open items carry forward. Activity linked to a shown done entry folds under it.
 * All other activity in the period goes to the Also section, also when it links to an entry that is not shown.
 */
export function standupModel(journal: ReportJournal, opts: ReportOptions, now: Date): StandupModel {
  const { repo, activity, config } = journal;
  const period = resolvePeriod(opts, now, config.weekStartsOn);
  const base = baseQuery(opts);
  const done = repo.find({ ...base, kind: ['done'], from: period.start.toISOString(), to: period.end.toISOString() });
  const open = repo.find({ ...base, kind: ['blocker', 'next'], status: 'open', to: period.end.toISOString() });
  const linked = activity.linkedTo(done.map((e) => e.id));
  const unlinked = filterActivity(
    activity.find({ from: period.start.toISOString(), to: period.end.toISOString(), repo: opts.repo }),
    opts, config.projectAliases,
  );
  return buildStandup({ period, done, open, now, staleAfterDays: config.staleAfterDays, linked, unlinked });
}

export function workLogModel(journal: ReportJournal, opts: ReportOptions, now: Date): WorkLogModel {
  const { repo, activity, config } = journal;
  const period = resolvePeriod(opts, now, config.weekStartsOn);
  const entries = repo.find({ ...baseQuery(opts), from: period.start.toISOString(), to: period.end.toISOString() });
  return buildWorkLog(period, entries, activity.linkedTo(entries.map((e) => e.id)));
}
