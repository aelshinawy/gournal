import type { Command } from 'commander';
import { execGh } from '../../sources';
import { parseSince, runSync, syncSummaryLine } from '../sync';
import type { CliContext } from './context';

export function registerSync(program: Command, ctx: CliContext): void {
  program
    .command('sync')
    .description('Fetch your GitHub activity (PRs, commits, reviews) through the gh CLI. Gournal links the activity to your entries.')
    .option('--since <date>', 'Fetch activity from this date. Use a local day or an ISO timestamp. Without this option, gournal starts at the stored sync cursor. With no cursor, it starts github.initialSyncDays days before now.')
    .action(async (options: { since?: string }) => {
      const since = options.since === undefined ? undefined : parseSince(options.since); // fail before the journal opens
      const report = await ctx.withJournal((journal) =>
        runSync(journal, ctx.io.gh ?? execGh(), { since, auto: false, now: new Date() }));
      if (report.status === 'failed') throw new Error(report.warning ?? 'GitHub sync failed');
      const line = syncSummaryLine(report);
      ctx.io.out(report.status === 'partial' && report.warning ? `${line} ${report.warning}` : line);
    });
}
