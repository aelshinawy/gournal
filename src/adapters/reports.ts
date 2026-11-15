import { buildStandup, buildWorkLog, resolvePeriod } from '../core';
import type { Config, EntryRepository, Query, StandupModel, WorkLogModel } from '../core';

export interface ReportOptions {
  yesterday?: boolean; week?: boolean; month?: boolean;
  from?: string; to?: string;
  project?: string; repo?: string; tags?: string[];
}

/** The filters that do not depend on the period. The period owns the date bounds. */
function baseQuery(opts: ReportOptions): Query {
  return { project: opts.project, repo: opts.repo, tags: opts.tags };
}

/**
 * Done entries use the period bounds. Open blockers and next items use only the end bound,
 * so older open items carry forward.
 */
export function standupModel(repo: EntryRepository, config: Config, opts: ReportOptions, now: Date): StandupModel {
  const period = resolvePeriod(opts, now, config.weekStartsOn);
  const base = baseQuery(opts);
  const done = repo.find({ ...base, kind: ['done'], from: period.start.toISOString(), to: period.end.toISOString() });
  const open = repo.find({ ...base, kind: ['blocker', 'next'], status: 'open', to: period.end.toISOString() });
  return buildStandup({ period, done, open, now, staleAfterDays: config.staleAfterDays });
}

export function workLogModel(repo: EntryRepository, config: Config, opts: ReportOptions, now: Date): WorkLogModel {
  const period = resolvePeriod(opts, now, config.weekStartsOn);
  const entries = repo.find({ ...baseQuery(opts), from: period.start.toISOString(), to: period.end.toISOString() });
  return buildWorkLog(period, entries);
}
