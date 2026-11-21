import type { Command } from 'commander';
import { execGh } from '../../sources';
import { maybeAutoSync } from '../sync';
import { standupModel, workLogModel } from '../reports';
import { EXPORT_FORMATS, buildStats } from '../../core';
import { OPTION_TEXT } from '../shared/option-text';
import { exportCsv, exportMarkdown, green, standupText, statsText, workLogText } from '../../render';
import { exportBundle, writeExportFile, assertExportTarget } from '../../storage';
import type { CliContext } from './context';
import { buildQuery, splitList, type PeriodCliOptions } from './options';
import { withSpinner, SYNC_SPINNER_TEXT } from './spinner';

export function registerStandup(program: Command, ctx: CliContext): void {
  program
    .command('standup')
    .description('Show a standup report for today, or for the period that you choose. The report lists done entries, open blockers, open next items, and a Stale line. An Also line counts the GitHub activity that no done entry links to. The --from and --to options override --yesterday, --week, and --month.')
    .option('-y, --yesterday', OPTION_TEXT.yesterday)
    .option('-w, --week', OPTION_TEXT.week)
    .option('-m, --month', OPTION_TEXT.month)
    .option('--from <date>', OPTION_TEXT.from)
    .option('--to <date>', OPTION_TEXT.to)
    .option('-p, --project <project>', OPTION_TEXT.project)
    .option('--repo <owner/name>', OPTION_TEXT.repo)
    .option('-t, --tags <tags>', `${OPTION_TEXT.tags} Separate tags with commas.`)
    .option('--activity', 'List every GitHub activity item that is not linked to a done entry in this report. Without this option, the report shows counts and one line for each merged or reviewed PR.')
    .action(async (options: PeriodCliOptions & { activity?: boolean }) => {
      buildQuery(options); // fail on a bad --from or --to before the journal opens
      await ctx.withJournal(async (journal) => {
        const now = new Date();
        const warning = await withSpinner(SYNC_SPINNER_TEXT, () => maybeAutoSync(journal, ctx.io.gh ?? execGh(), now), ctx.io.spinnerStream);
        if (warning) ctx.io.err(warning);
        const model = standupModel(journal, { ...options, tags: splitList(options.tags) }, now);
        ctx.io.out(standupText(model, { expandActivity: options.activity === true }));
      });
    });
}

export function registerLog(program: Command, ctx: CliContext): void {
  program
    .command('log')
    .description('Show your entries in time order, grouped by day. The log covers today unless you choose a period. The --from and --to options override --yesterday, --week, and --month.')
    .option('-y, --yesterday', OPTION_TEXT.yesterday)
    .option('-w, --week', OPTION_TEXT.week)
    .option('-m, --month', OPTION_TEXT.month)
    .option('--from <date>', OPTION_TEXT.from)
    .option('--to <date>', OPTION_TEXT.to)
    .option('-p, --project <project>', OPTION_TEXT.project)
    .option('--repo <owner/name>', OPTION_TEXT.repo)
    .option('-t, --tags <tags>', `${OPTION_TEXT.tags} Separate tags with commas.`)
    .action(async (options: PeriodCliOptions) => {
      buildQuery(options); // fail on a bad --from or --to before the journal opens
      await ctx.withJournal(async (journal) => {
        const now = new Date();
        const warning = await withSpinner(SYNC_SPINNER_TEXT, () => maybeAutoSync(journal, ctx.io.gh ?? execGh(), now), ctx.io.spinnerStream);
        if (warning) ctx.io.err(warning);
        ctx.io.out(workLogText(workLogModel(journal, { ...options, tags: splitList(options.tags) }, now)));
      });
    });
}

export function registerStats(program: Command, ctx: CliContext): void {
  program
    .command('stats')
    .description('Show how many entries you have for each project and tag, and your current daily streak.')
    .option('-p, --project <project>', OPTION_TEXT.project)
    .action(async (options: { project?: string }) => {
      const query = buildQuery({ project: options.project });
      await ctx.withJournal(({ repo }) => {
        ctx.io.out(statsText(buildStats(repo.find(query), new Date())));
      });
    });
}

export function registerExport(program: Command, ctx: CliContext): void {
  program
    .command('export')
    .description('Write journal entries as Markdown or CSV, or write a full bundle for backup and import. The project, tag, and date options apply to md and csv only. Output goes to the terminal unless you pass --output.')
    .option('-f, --format <format>', `${OPTION_TEXT.format} Use bundle for a full backup that gournal import reads.`, 'md')
    .option('-p, --project <project>', OPTION_TEXT.project)
    .option('-t, --tags <tags>', `${OPTION_TEXT.tags} Separate tags with commas.`)
    .option('--from <date>', OPTION_TEXT.from)
    .option('--to <date>', OPTION_TEXT.to)
    .option('-o, --output <file>', 'Write the output to this file instead of the terminal. The file mode is 0600. Gournal refuses to write through a symlink.')
    .option('--force', 'Replace the output file if it exists. Without this option, gournal stops when the file exists.')
    .action(async (options: { format: string; project?: string; tags?: string; from?: string; to?: string; output?: string; force?: boolean }) => {
      const exportFormat = options.format.toLowerCase();
      if (!(EXPORT_FORMATS as readonly string[]).includes(exportFormat)) {
        throw new Error(`Unknown format "${options.format}". Use md, csv, or bundle.`);
      }
      const query = buildQuery(options);
      // Check the target before any work, so a refusal costs nothing.
      if (options.output) assertExportTarget(options.output, options.force === true);

      await ctx.withJournal(async ({ repo, db, config }) => {
        let output: string;
        let count: number;
        if (exportFormat === 'bundle') {
          const bundle = exportBundle(db, config);
          output = JSON.stringify(bundle, null, 2);
          count = bundle.entries.length;
        } else {
          const entries = repo.find(query);
          output = exportFormat === 'csv' ? exportCsv(entries) : exportMarkdown(entries);
          count = entries.length;
        }

        if (options.output) {
          writeExportFile(options.output, output, options.force === true);
          ctx.io.out(green(`✓ Exported ${count} entries to ${options.output}`));
        } else {
          ctx.io.out(output);
        }
      });
    });
}
