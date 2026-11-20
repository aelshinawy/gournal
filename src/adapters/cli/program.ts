import { Command, CommanderError, Option } from 'commander';
import { execGh, resolveIdentity, type GhRunner } from '../../sources';
import { maybeAutoSync, parseSince, runSync, syncSummaryLine } from '../sync';
import { startMcpServer } from '../mcp';
import { createEntryWriter } from '../entry-writer';
import { writeNoteText } from '../write-note-text';
import { standupModel, workLogModel } from '../reports';
import { EXPORT_FORMATS, buildStats, kindList, parseKind, parseStatus, resolveQuery, shortId, stripControl, type Query } from '../../core';
import { OPTION_TEXT } from '../shared/option-text';
import {
  bold, entryLinesText, exportCsv, exportMarkdown, green, projectCountsText, red, standupText, statsText, tagCountsText, workLogText, yellow,
} from '../../render';
import fs from 'fs';
import path from 'path';
import { VERSION } from '../version';
import { confirm, confirmOrNo } from './confirm';
import { execFileRunner, setupClaude, stopHook, type CommandRunner } from '../setup';
import { openJournal, exportBundle, importBundle, gournalHome, userHomePath, hasFts5, rebuildSearchIndex, importLegacy, applyPlan, renderPlanDiff, writePrivateFile, writeExportFile, assertExportTarget, assertTargetDir } from '../../storage';
import type { Journal, MigrationPlan } from '../../storage';

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  home: string;
  isTTY: boolean;
  /** Test seam. The default runs the real gh. */
  gh?: GhRunner;
  /** The user's home, for `setup claude`. `home` above is the gournal home. Default: the profile folder at call time (os.homedir(), or USERPROFILE on Windows). */
  userHome?: string;
  /** Test seam for the clear and setup claude prompts. The default asks on the terminal with readline. */
  confirm?: (message: string, def: boolean) => Promise<boolean>;
  /** Test seam for `setup claude`. The default runs the claude CLI with execFile, no shell. */
  exec?: CommandRunner;
}

const CLEAR_QUESTION = 'Are you sure you want to clear all gournal entries?';

const splitList = (v?: string): string[] => (v ? v.split(',').map(x => x.trim()).filter(Boolean) : []);
const NO_FTS5_MESSAGE = 'This Node build has no FTS5; the search index cannot be rebuilt.';

interface PeriodCliOptions {
  yesterday?: boolean; week?: boolean; month?: boolean;
  from?: string; to?: string; project?: string; repo?: string; tags?: string;
}
interface FindCliOptions {
  project?: string; tags?: string; kind?: string; status?: string; repo?: string; from?: string; to?: string; limit?: string;
}

/** Build one Query from CLI options. Validate every value here, so a bad option fails before the journal opens. */
function buildQuery(options: Partial<FindCliOptions>, text?: string): Query {
  const kind = splitList(options.kind).map(parseKind);
  const status = options.status === undefined ? undefined : parseStatus(options.status);
  const query: Query = {
    project: options.project,
    repo: options.repo,
    tags: splitList(options.tags),
    text,
    kind: kind.length > 0 ? kind : undefined,
    status,
    from: options.from,
    to: options.to,
    limit: options.limit === undefined ? undefined : Number(options.limit),
  };
  resolveQuery(query, {}); // throws on a bad date or limit
  return query;
}

const stripNewline = (text: string): string => text.replace(/\n$/, '');

export function buildProgram(io: CliIo): Command {
  const program = new Command();

  /** Open the journal once for a command and close it when the command ends. */
  const withJournal = async <T>(fn: (journal: Journal) => T | Promise<T>, opts: { legacyImport?: boolean } = {}): Promise<T> => {
    const journal = openJournal(io.home, opts);
    try {
      return await fn(journal);
    } finally {
      journal.close();
    }
  };

  /** A failed daily backup warns and never stops the command. */
  const backupWithWarning = (journal: Journal): void => {
    try {
      journal.backupIfNeeded();
    } catch (err) {
      io.err(`gournal: daily backup failed: ${(err as Error).message}`);
    }
  };

  const writerFor = (journal: Journal) => createEntryWriter(journal, { retryMemory: false, clock: Date.now });

  program
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.out(stripNewline(text)),
      writeErr: (text) => io.err(stripNewline(text)),
    })
    .name('gournal')
    .description('CLI development journal with Git integration')
    .version(VERSION);

  program
    .command('add')
    .argument('<summary>', 'One line that says what happened.')
    .description('Add a journal entry. Gournal records the project, repo, and branch of the current directory. A summary over 120 characters, or with a line break, is cut at the first sentence. The full text goes to details, and a note prints.')
    .option('-t, --tags <tags>', 'Tag the entry. Separate tags with commas.', '')
    .option('-d, --details <text>', 'Save longer text with the entry. The summary stays one line.')
    .addOption(new Option('-k, --kind <kind>', `Set the entry kind: ${kindList({ defaultKind: 'done' })}.`).default(undefined, 'done'))
    .option('--resolves <ids>', 'Close the open blocker or next entries with these ids. Separate ids with commas. Gournal drops an id that it cannot resolve, adds the entry, and prints a note.')
    .action(async (summary: string, options: { tags: string; details?: string; kind?: string; resolves?: string }) => {
      const kind = options.kind === undefined ? undefined : parseKind(options.kind);
      await withJournal((journal) => {
        const identity = resolveIdentity(io.cwd, journal.config.projectAliases);
        const { entry, notes } = writerFor(journal).add({
          summary,
          details: options.details,
          kind,
          identity,
          source: 'cli',
          tags: splitList(options.tags),
          resolves: splitList(options.resolves),
        });
        io.out(green(`✓ Entry added! (${shortId(entry.id)})`));
        if (notes.some((n) => n.type === 'split')) {
          io.out(yellow('Note: summary was long, the rest went to details.'));
        }
        for (const note of notes) if (note.type !== 'split') io.err(writeNoteText(note));
      });
    });

  program
    .command('clear')
    .description('Remove all journal entries after you confirm. This command needs a terminal.')
    .action(async () => {
      if (!io.isTTY) throw new Error('Not a terminal; nothing cleared.');
      let confirmed: boolean;
      try {
        confirmed = await (io.confirm ?? confirm)(red(CLEAR_QUESTION), false);
      } catch {
        throw new Error('Not a terminal; nothing cleared.');
      }
      if (!confirmed) return;
      await withJournal((journal) => {
        const count = writerFor(journal).clear();
        io.out(green(`✓ Cleared ${count} entries (restore any with gournal restore <id>).`));
      });
    });

  program
    .command('undo')
    .description('Remove the last entry that you added on this device. Restore it later by id.')
    .action(async () => {
      await withJournal((journal) => {
        const removed = writerFor(journal).undo();
        if (!removed) {
          io.out(yellow('No entries to undo.'));
          return;
        }
        io.out(green(`✓ Removed: ${stripControl(removed.summary)} (restore with gournal restore ${shortId(removed.id)})`));
      });
    });

  program
    .command('restore')
    .argument('<id>', 'The full id or the last 8 characters of the removed entry.')
    .description('Bring back a removed entry.')
    .action(async (id: string) => {
      await withJournal((journal) => {
        const entry = writerFor(journal).restore(id);
        io.out(green(`✓ Restored: ${stripControl(entry.summary)}`));
      });
    });

  program
    .command('resolve')
    .argument('<id>', 'The full id or the last 8 characters of the entry.')
    .description('Mark an open blocker or next entry as resolved.')
    .action(async (id: string) => {
      await withJournal((journal) => {
        const entry = writerFor(journal).resolve(id);
        io.out(green(`✓ Resolved: ${stripControl(entry.summary)}`));
      });
    });

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
      await withJournal(async (journal) => {
        const warning = await maybeAutoSync(journal, io.gh ?? execGh(), new Date());
        if (warning) io.err(warning);
        const model = standupModel(journal, { ...options, tags: splitList(options.tags) }, new Date());
        io.out(standupText(model, { expandActivity: options.activity === true }));
      });
    });

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
      await withJournal(async (journal) => {
        const warning = await maybeAutoSync(journal, io.gh ?? execGh(), new Date());
        if (warning) io.err(warning);
        io.out(workLogText(workLogModel(journal, { ...options, tags: splitList(options.tags) }, new Date())));
      });
    });

  program
    .command('stats')
    .description('Show how many entries you have for each project and tag, and your current daily streak.')
    .option('-p, --project <project>', OPTION_TEXT.project)
    .action(async (options: { project?: string }) => {
      const query = buildQuery({ project: options.project });
      await withJournal(({ repo }) => {
        io.out(statsText(buildStats(repo.find(query), new Date())));
      });
    });

  program
    .command('tags')
    .description('List every tag that you use, with the number of entries for each tag.')
    .action(async () => {
      await withJournal(({ repo }) => {
        io.out(tagCountsText(repo.tagCounts()));
      });
    });

  program
    .command('projects')
    .description('List every project that you log to, with the number of entries for each project.')
    .action(async () => {
      await withJournal(({ repo }) => {
        io.out(projectCountsText(repo.projectCounts()));
      });
    });

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

      await withJournal(async ({ repo, db, config }) => {
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
          io.out(green(`✓ Exported ${count} entries to ${options.output}`));
        } else {
          io.out(output);
        }
      });
    });

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
      await withJournal((journal) => {
        const { db, repo, config } = journal;
        // An empty database has nothing to protect. It must not take the day's backup slot.
        const hasEntries = (db.prepare('SELECT 1 AS x FROM entries LIMIT 1').get() as { x: number } | undefined) !== undefined;
        if (hasEntries) {
          backupWithWarning(journal);
        }
        const r = importBundle(db, bundle, config);
        io.out(green(`Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} unchanged, ${r.deduplicated} duplicates merged.`));
        // The bundle's legacy keys are in place now. The legacy import adds only lines the bundle did not know.
        const jsonPath = path.join(io.home, 'entries.json');
        if (fs.existsSync(jsonPath)) {
          try {
            importLegacy(db, repo, config, jsonPath);
          } catch (err) {
            io.err(`gournal: legacy import failed; will retry (${(err as Error).message})`);
          }
        }
      }, { legacyImport: false });
    });

  program
    .command('find')
    .argument('<text>', 'Words to search for. Every word must match.')
    .description('Search your entries for words. Every word must match. The oldest entries come first. Matching can differ between Node builds: with FTS5 a word matches the start of whole words, and without FTS5 it matches any part of the text.')
    .option('-p, --project <project>', OPTION_TEXT.project)
    .option('-t, --tags <tags>', `${OPTION_TEXT.tags} Separate tags with commas.`)
    .option('-k, --kind <kinds>', `${OPTION_TEXT.kind} Separate kinds with commas.`)
    .option('--status <status>', OPTION_TEXT.status)
    .option('--repo <owner/name>', OPTION_TEXT.repo)
    .option('--from <date>', OPTION_TEXT.from)
    .option('--to <date>', OPTION_TEXT.to)
    .option('-n, --limit <n>', `${OPTION_TEXT.limit} The oldest come first.`)
    .action(async (text: string, options: FindCliOptions) => {
      const query = buildQuery(options, text);
      await withJournal(({ repo }) => {
        const results = repo.find(query);
        io.out(bold(`Found ${results.length} entries:\n`));
        if (results.length > 0) io.out(entryLinesText(results));
      });
    });

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
      const jsonPath = path.join(io.home, 'entries.json');
      const journal = openJournal(io.home);
      try {
        if (!options.plan) {
          const r = importLegacy(journal.db, journal.repo, journal.config, jsonPath);
          io.out(`Imported ${r.imported} entries (${r.alreadyPresent} already present).`);
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
          io.out(`Dry run: ${changes.length} entries would change. Diff written to ${target}.`);
        } else {
          if (snapshot) io.out(`Snapshot: ${snapshot}`);
          io.out(`Updated ${changes.length} entries.`);
        }
      } finally {
        journal.close();
      }
    });

  const index = program.command('index').description('Maintain the full-text search index.');
  index
    .command('rebuild')
    .description('Drop and recreate the full-text search index. It takes today\'s backup first, if none exists yet. Run it only when every gournal process uses a Node build with FTS5.')
    .action(async () => {
      await withJournal((journal) => {
        const { db } = journal;
        // Check FTS5 first, so a refusal does not use up the daily backup slot.
        if (!hasFts5(db)) throw new Error(NO_FTS5_MESSAGE);
        backupWithWarning(journal);
        const { indexed } = rebuildSearchIndex(db);
        io.out(green(`Search index rebuilt: ${indexed} entries.`));
      });
    });

  program
    .command('sync')
    .description('Fetch your GitHub activity (PRs, commits, reviews) through the gh CLI. Gournal links the activity to your entries.')
    .option('--since <date>', 'Fetch activity from this date. Use a local day or an ISO timestamp. Without this option, gournal starts at the stored sync cursor. With no cursor, it starts github.initialSyncDays days before now.')
    .action(async (options: { since?: string }) => {
      const since = options.since === undefined ? undefined : parseSince(options.since); // fail before the journal opens
      const report = await withJournal((journal) =>
        runSync(journal, io.gh ?? execGh(), { since, auto: false, now: new Date() }));
      if (report.status === 'failed') throw new Error(report.warning ?? 'GitHub sync failed');
      const line = syncSummaryLine(report);
      io.out(report.status === 'partial' && report.warning ? `${line} ${report.warning}` : line);
    });

  const setup = program.command('setup').description('Set gournal up for another tool.');
  setup
    .command('claude')
    .description('Register the gournal MCP server and install the gournal skill for Claude Code. You can also add a Stop hook.')
    .option('--uninstall', 'Remove the MCP server, the skill, and the hook that setup added.')
    .option('-y, --yes', 'Answer yes to the install and removal prompts. On a terminal, the prompt to replace an existing MCP registration still asks. Without a terminal and without this option, setup prints its plan and exits with code 1.')
    .option('--hook', 'Also add the Stop hook. The hook reminds Claude to log its work. With --yes, the hook is added only when you pass this option. Before it changes an existing settings.json, setup saves a copy as settings.json.gournal-backup if that file does not exist yet.')
    .action(async (options: { uninstall?: boolean; yes?: boolean; hook?: boolean }) => {
      const code = await setupClaude({
        out: io.out, err: io.err, isTTY: io.isTTY,
        home: io.userHome ?? userHomePath(),
        confirm: io.confirm ?? confirmOrNo,
        exec: io.exec ?? execFileRunner,
      }, { uninstall: options.uninstall === true, yes: options.yes === true, hook: options.hook === true });
      if (code !== 0) throw new CommanderError(code, 'gournal.setup', 'setup did not finish'); // setup already printed why
    });

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
      const result = await stopHook(stdin, io.home, new Date());
      if (result !== null) io.out(result);
    });

  program
    .command('mcp')
    .description('Start the gournal MCP server on stdio. It offers entries, standup reports, work logs, and export as tools.')
    .action(async () => {
      await startMcpServer();
    });

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
