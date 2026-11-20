import fs from 'fs';
import path from 'path';
import { Command, CommanderError } from 'commander';
import { execGh } from '../../sources';
import { maybeAutoSync, parseSince, runSync, syncSummaryLine } from '../sync';
import { startMcpServer } from '../mcp';
import { standupModel, workLogModel } from '../reports';
import { EXPORT_FORMATS, buildStats } from '../../core';
import { OPTION_TEXT } from '../shared/option-text';
import { exportCsv, exportMarkdown, green, red, standupText, statsText, workLogText } from '../../render';
import { VERSION } from '../version';
import { confirmOrNo } from './confirm';
import { execFileRunner, setupClaude, stopHook } from '../setup';
import { openJournal, exportBundle, importBundle, gournalHome, userHomePath, hasFts5, rebuildSearchIndex, importLegacy, applyPlan, renderPlanDiff, writePrivateFile, writeExportFile, assertExportTarget, assertTargetDir, type MigrationPlan } from '../../storage';
import { createCliContext, type CliIo, type CliContext, type RegisterCommand } from './context';
import { buildQuery, splitList, type PeriodCliOptions } from './options';
import { registerAdd, registerClear, registerUndo, registerRestore, registerResolve, registerTags, registerProjects, registerFind } from './entries';

const NO_FTS5_MESSAGE = 'This Node build has no FTS5; the search index cannot be rebuilt.';

const stripNewline = (text: string): string => text.replace(/\n$/, '');

function registerStandup(program: Command, ctx: CliContext): void {
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
        const warning = await maybeAutoSync(journal, ctx.io.gh ?? execGh(), new Date());
        if (warning) ctx.io.err(warning);
        const model = standupModel(journal, { ...options, tags: splitList(options.tags) }, new Date());
        ctx.io.out(standupText(model, { expandActivity: options.activity === true }));
      });
    });
}

function registerLog(program: Command, ctx: CliContext): void {
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
        const warning = await maybeAutoSync(journal, ctx.io.gh ?? execGh(), new Date());
        if (warning) ctx.io.err(warning);
        ctx.io.out(workLogText(workLogModel(journal, { ...options, tags: splitList(options.tags) }, new Date())));
      });
    });
}

function registerStats(program: Command, ctx: CliContext): void {
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

function registerExport(program: Command, ctx: CliContext): void {
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

function registerImport(program: Command, ctx: CliContext): void {
  program
    .command('import')
    .argument('<file>', 'Path of the bundle file.')
    .description('Load entries from a bundle file. Make the bundle with gournal export --format bundle.')
    .action(async (file: string) => {
      let bundle: unknown;
      try {
        bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        if (err instanceof SyntaxError) throw new Error(`Bundle file ${file} is not valid JSON: ${err.message}`);
        throw err;
      }
      await ctx.withJournal((journal) => {
        const { db, repo, config } = journal;
        // An empty database has nothing to protect. It must not take the day's backup slot.
        const hasEntries = (db.prepare('SELECT 1 AS x FROM entries LIMIT 1').get() as { x: number } | undefined) !== undefined;
        if (hasEntries) {
          ctx.backupWithWarning(journal);
        }
        const r = importBundle(db, bundle, config);
        ctx.io.out(green(`Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} unchanged, ${r.deduplicated} duplicates merged.`));
        // The bundle's legacy keys are in place now. The legacy import adds only lines the bundle did not know.
        const jsonPath = path.join(ctx.io.home, 'entries.json');
        if (fs.existsSync(jsonPath)) {
          try {
            importLegacy(db, repo, config, jsonPath);
          } catch (err) {
            ctx.io.err(`gournal: legacy import failed; will retry (${(err as Error).message})`);
          }
        }
      }, { legacyImport: false });
    });
}

function registerMigrate(program: Command, ctx: CliContext): void {
  program
    .command('migrate')
    .description('Import the old entries.json file into the database, or apply a reviewed migration plan.')
    .option('--plan <file>', 'Apply this reviewed migration plan (a JSON file).')
    .option('--dry-run', 'Compute the changes and write nothing. Needs --plan and --diff.')
    .option('--diff <file>', 'Write the dry-run diff (Markdown) to this file. Needs --dry-run.')
    .action(async (options: { plan?: string; dryRun?: boolean; diff?: string }) => {
      if (options.diff && !options.dryRun) throw new Error('--diff only applies with --dry-run');
      if (options.dryRun && !options.plan) throw new Error('--dry-run needs --plan <file>');
      if (options.dryRun && !options.diff) throw new Error('--dry-run needs --diff <file>');
      // Check the diff folder before any work, so a missing folder gives a clear message.
      if (options.dryRun && options.diff) assertTargetDir(options.diff);
      const jsonPath = path.join(ctx.io.home, 'entries.json');
      const journal = openJournal(ctx.io.home);
      try {
        if (!options.plan) {
          const r = importLegacy(journal.db, journal.repo, journal.config, jsonPath);
          ctx.io.out(`Imported ${r.imported} entries (${r.alreadyPresent} already present).`);
          return;
        }
        let plan: MigrationPlan;
        try {
          plan = JSON.parse(fs.readFileSync(options.plan, 'utf8')) as MigrationPlan;
        } catch (err) {
          if (err instanceof SyntaxError) throw new Error(`Plan file ${options.plan} is not valid JSON: ${err.message}`);
          throw err;
        }
        const { changes, snapshot } = applyPlan(journal.db, journal.repo, journal.config, jsonPath, plan, { dryRun: !!options.dryRun });
        if (options.dryRun) {
          const target = options.diff as string;
          writePrivateFile(target, renderPlanDiff(changes));
          ctx.io.out(`Dry run: ${changes.length} entries would change. Diff written to ${target}.`);
        } else {
          if (snapshot) ctx.io.out(`Snapshot: ${snapshot}`);
          ctx.io.out(`Updated ${changes.length} entries.`);
        }
      } finally {
        journal.close();
      }
    });
}

function registerIndex(program: Command, ctx: CliContext): void {
  const index = program.command('index').description('Maintain the full-text search index.');
  index
    .command('rebuild')
    .description('Drop and recreate the full-text search index. It takes today\'s backup first, if none exists yet. Run it only when every gournal process uses a Node build with FTS5.')
    .action(async () => {
      await ctx.withJournal((journal) => {
        const { db } = journal;
        // Check FTS5 first, so a refusal does not use up the daily backup slot.
        if (!hasFts5(db)) throw new Error(NO_FTS5_MESSAGE);
        ctx.backupWithWarning(journal);
        const { indexed } = rebuildSearchIndex(db);
        ctx.io.out(green(`Search index rebuilt: ${indexed} entries.`));
      });
    });
}

function registerSync(program: Command, ctx: CliContext): void {
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

function registerSetup(program: Command, ctx: CliContext): void {
  const setup = program.command('setup').description('Set gournal up for another tool.');
  setup
    .command('claude')
    .description('Register the gournal MCP server and install the gournal skill for Claude Code. You can also add a Stop hook.')
    .option('--uninstall', 'Remove the MCP server, the skill, and the hook that setup added.')
    .option('-y, --yes', 'Answer yes to the install and removal prompts. On a terminal, the prompt to replace an existing MCP registration still asks. Without a terminal and without this option, setup prints its plan and exits with code 1.')
    .option('--hook', 'Also add the Stop hook. The hook reminds Claude to log its work. With --yes, the hook is added only when you pass this option. Before it changes an existing settings.json, setup saves a copy as settings.json.gournal-backup if that file does not exist yet.')
    .action(async (options: { uninstall?: boolean; yes?: boolean; hook?: boolean }) => {
      const code = await setupClaude({
        out: ctx.io.out, err: ctx.io.err, isTTY: ctx.io.isTTY,
        home: ctx.io.userHome ?? userHomePath(),
        confirm: ctx.io.confirm ?? confirmOrNo,
        exec: ctx.io.exec ?? execFileRunner,
      }, { uninstall: options.uninstall === true, yes: options.yes === true, hook: options.hook === true });
      if (code !== 0) throw new CommanderError(code, 'gournal.setup', 'setup did not finish'); // setup already printed why
    });
}

function registerHook(program: Command, ctx: CliContext): void {
  const hook = program.command('hook', { hidden: true }).description('Claude Code hook entry points.');
  hook
    .command('stop')
    .description('Stop hook. Ask the agent to log edited work once per session.')
    .action(async () => {
      // Never opens the database. Never fails: any error means no output and exit 0.
      let stdin = '';
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        stdin = Buffer.concat(chunks).toString('utf8');
      } catch {
        return;
      }
      const result = await stopHook(stdin, ctx.io.home, new Date());
      if (result !== null) ctx.io.out(result);
    });
}

function registerMcp(program: Command, ctx: CliContext): void {
  program
    .command('mcp')
    .description('Start the gournal MCP server on stdio. It offers entries, standup reports, work logs, and export as tools.')
    .action(async () => {
      await startMcpServer();
    });
}

const COMMANDS: RegisterCommand[] = [
  registerAdd,
  registerClear,
  registerUndo,
  registerRestore,
  registerResolve,
  registerStandup,
  registerLog,
  registerStats,
  registerTags,
  registerProjects,
  registerExport,
  registerImport,
  registerFind,
  registerMigrate,
  registerIndex,
  registerSync,
  registerSetup,
  registerHook,
  registerMcp,
];

export function buildProgram(io: CliIo): Command {
  const program = new Command();
  const ctx = createCliContext(io);

  program
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.out(stripNewline(text)),
      writeErr: (text) => io.err(stripNewline(text)),
    })
    .name('gournal')
    .description('CLI development journal with Git integration')
    .version(VERSION);

  for (const register of COMMANDS) register(program, ctx);

  return program;
}

export async function runCli(argv: string[], io: Partial<CliIo> = {}): Promise<number> {
  const full: CliIo = {
    out: io.out ?? ((text) => { process.stdout.write(`${text}\n`); }),
    err: io.err ?? ((text) => { process.stderr.write(`${text}\n`); }),
    cwd: io.cwd ?? process.cwd(),
    home: io.home ?? gournalHome(),
    isTTY: io.isTTY ?? process.stdin.isTTY === true,
    gh: io.gh,
  };
  try {
    await buildProgram(full).parseAsync(argv);
    return 0;
  } catch (err) {
    // Commander has already written its own help, version, and usage errors.
    if (err instanceof CommanderError) return err.exitCode;
    full.err(red(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}
