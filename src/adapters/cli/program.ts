import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import { execGh, resolveIdentity, type GhRunner } from '../../sources';
import { parseSince, relinkAfterWrite, runSync, syncSummaryLine } from '../sync';
import { startMcpServer } from '../mcp';
import { standupModel, workLogModel } from '../reports';
import { buildStats, checkSummary, resolveQuery, shortId } from '../../core';
import type { Kind, Query, Status } from '../../core';
import {
  entryLinesText, exportCsv, exportMarkdown, projectCountsText, standupText, statsText, tagCountsText, workLogText,
} from '../../render';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { VERSION } from '../version';
import { clearConfirmQuestion } from './prompts';
import { openJournal, exportBundle, importBundle, backupDbIfNeeded, gournalHome, hasFts5, rebuildSearchIndex, importLegacy, applyPlan, renderPlanDiff } from '../../storage';
import type { Journal, MigrationPlan } from '../../storage';

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  home: string;
  isTTY: boolean;
  /** Test seam. The default runs the real gh. */
  gh?: GhRunner;
}

const KINDS: Kind[] = ['done', 'blocker', 'next'];
const splitList = (v?: string): string[] => (v ? v.split(',').map(x => x.trim()).filter(Boolean) : []);
const STATUSES: Status[] = ['open', 'resolved'];
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
  const kind = splitList(options.kind);
  for (const k of kind) {
    if (!KINDS.includes(k as Kind)) throw new Error(`Unknown kind "${k}". Use done, blocker, or next.`);
  }
  if (options.status !== undefined && !STATUSES.includes(options.status as Status)) {
    throw new Error(`Unknown status "${options.status}". Use open or resolved.`);
  }
  const query: Query = {
    project: options.project,
    repo: options.repo,
    tags: splitList(options.tags),
    text,
    kind: kind.length > 0 ? (kind as Kind[]) : undefined,
    status: options.status as Status | undefined,
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
    .command('add <summary>')
    .description('Add a new journal entry')
    .option('-t, --tags <tags>', 'Comma-separated tags', '')
    .option('-d, --details <text>', 'Longer text for this entry')
    .option('-k, --kind <kind>', 'done (default), blocker, or next')
    .option('--resolves <ids>', 'Comma-separated ids of open blocker or next entries that this entry closes')
    .action(async (summary: string, options: { tags: string; details?: string; kind?: string; resolves?: string }) => {
      if (options.kind !== undefined && !KINDS.includes(options.kind as Kind)) {
        throw new Error(`Unknown kind "${options.kind}". Use done, blocker, or next.`);
      }
      const check = checkSummary(summary, options.details, { allowSplit: true });
      if (!check.ok) throw new Error(check.error);
      await withJournal((journal) => {
        const { repo, config } = journal;
        const id = resolveIdentity(io.cwd, config.projectAliases);
        const entry = repo.add({
          summary: check.summary,
          details: check.details,
          kind: options.kind as Kind | undefined,
          project: id.project,
          repo: id.repo ?? undefined,
          branch: id.branch ?? undefined,
          source: 'cli',
          tags: splitList(options.tags),
          resolves: splitList(options.resolves),
        });
        relinkAfterWrite(journal, [entry.id]);
        io.out(chalk.green(`✓ Entry added! (${shortId(entry.id)})`));
        if (check.summary !== summary.trim()) {
          io.out(chalk.yellow('Note: summary was long, the rest went to details.'));
        }
      });
    });

  program
    .command('clear')
    .description('Clear all journal entries')
    .action(async () => {
      if (!io.isTTY) throw new Error('Not a terminal; nothing cleared.');
      let confirmed: boolean;
      try {
        ({ confirm: confirmed } = await inquirer.prompt([
          { ...clearConfirmQuestion, message: chalk.red(clearConfirmQuestion.message) },
        ]));
      } catch {
        throw new Error('Not a terminal; nothing cleared.');
      }
      if (!confirmed) return;
      await withJournal(({ repo }) => {
        const count = repo.softDeleteAll();
        io.out(chalk.green(`✓ Cleared ${count} entries (restore any with gournal restore <id>).`));
      });
    });

  program
    .command('undo')
    .description('Remove the most recently added journal entry')
    .action(async () => {
      await withJournal(({ repo }) => {
        const latest = repo.latestForDevice();
        if (!latest) {
          io.out(chalk.yellow('No entries to undo.'));
          return;
        }
        const removed = repo.softDelete(latest.id);
        io.out(chalk.green(`✓ Removed: ${removed.summary} (restore with gournal restore ${shortId(removed.id)})`));
      });
    });

  program
    .command('restore <id>')
    .description('Restore a removed journal entry (full id or last 8 characters)')
    .action(async (id: string) => {
      await withJournal(({ repo }) => {
        const entry = repo.restore(id);
        io.out(chalk.green(`✓ Restored: ${entry.summary}`));
      });
    });

  program
    .command('resolve <id>')
    .description('Mark an open blocker or next entry as resolved (full id or last 8 characters)')
    .action(async (id: string) => {
      await withJournal(({ repo }) => {
        const entry = repo.resolve(id);
        io.out(chalk.green(`✓ Resolved: ${entry.summary}`));
      });
    });

  program
    .command('standup')
    .description('Generate standup report: Done, open Blockers and Next items, and a Stale line')
    .option('-y, --yesterday', 'Include yesterday\'s entries')
    .option('-w, --week', 'Show weekly summary')
    .option('-m, --month', 'Show monthly summary')
    .option('--from <date>', 'Start date (inclusive, local day or ISO timestamp)')
    .option('--to <date>', 'End date (inclusive, local day or ISO timestamp)')
    .option('-p, --project <project>', 'Filter by project name')
    .option('--repo <owner/name>', 'Filter by repository')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .action(async (options: PeriodCliOptions) => {
      buildQuery(options); // fail on a bad --from or --to before the journal opens
      await withJournal(({ repo, config }) => {
        io.out(standupText(standupModel(repo, config, { ...options, tags: splitList(options.tags) }, new Date())));
      });
    });

  program
    .command('log')
    .description('Show a chronological work log, grouped by day (today by default)')
    .option('-y, --yesterday', 'Include yesterday\'s entries')
    .option('-w, --week', 'Show weekly log')
    .option('-m, --month', 'Show monthly log')
    .option('--from <date>', 'Start date (inclusive, local day or ISO timestamp)')
    .option('--to <date>', 'End date (inclusive, local day or ISO timestamp)')
    .option('-p, --project <project>', 'Filter by project name')
    .option('--repo <owner/name>', 'Filter by repository')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .action(async (options: PeriodCliOptions) => {
      buildQuery(options); // fail on a bad --from or --to before the journal opens
      await withJournal(({ repo, config }) => {
        io.out(workLogText(workLogModel(repo, config, { ...options, tags: splitList(options.tags) }, new Date())));
      });
    });

  program
    .command('stats')
    .description('Show entry counts by project/tag and your current daily streak')
    .option('-p, --project <project>', 'Filter by project name')
    .action(async (options: { project?: string }) => {
      const query = buildQuery({ project: options.project });
      await withJournal(({ repo }) => {
        io.out(statsText(buildStats(repo.find(query), new Date())));
      });
    });

  program
    .command('tags')
    .description('List distinct tags with entry counts')
    .action(async () => {
      await withJournal(({ repo }) => {
        io.out(tagCountsText(repo.tagCounts()));
      });
    });

  program
    .command('projects')
    .description('List distinct projects with entry counts')
    .action(async () => {
      await withJournal(({ repo }) => {
        io.out(projectCountsText(repo.projectCounts()));
      });
    });

  program
    .command('export')
    .description('Export journal entries to Markdown, CSV, or a full bundle')
    .option('-f, --format <format>', 'Output format: md, csv, or bundle', 'md')
    .option('-p, --project <project>', 'Filter by project name (md and csv only)')
    .option('-t, --tags <tags>', 'Comma-separated tags (md and csv only)')
    .option('--from <date>', 'Start date (inclusive, md and csv only)')
    .option('--to <date>', 'End date (inclusive, md and csv only)')
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .action(async (options: { format: string; project?: string; tags?: string; from?: string; to?: string; output?: string }) => {
      const exportFormat = options.format.toLowerCase();
      if (exportFormat !== 'md' && exportFormat !== 'csv' && exportFormat !== 'bundle') {
        throw new Error(`Unknown format "${options.format}". Use md, csv, or bundle.`);
      }
      const query = buildQuery(options);

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
          await fs.writeFile(options.output, output);
          io.out(chalk.green(`✓ Exported ${count} entries to ${options.output}`));
        } else {
          io.out(output);
        }
      });
    });

  program
    .command('import <file>')
    .description('Import a bundle file made by gournal export --format bundle')
    .action(async (file: string) => {
      let bundle: unknown;
      try {
        bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        if (err instanceof SyntaxError) throw new Error(`Bundle file ${file} is not valid JSON: ${err.message}`);
        throw err;
      }
      await withJournal(({ db, repo, config }) => {
        // An empty database has nothing to protect. It must not take the day's backup slot.
        const hasEntries = (db.prepare('SELECT 1 AS x FROM entries LIMIT 1').get() as { x: number } | undefined) !== undefined;
        if (hasEntries) {
          try {
            backupDbIfNeeded(db, path.join(io.home, 'gournal.db'));
          } catch (err) {
            io.err(`gournal: daily backup failed: ${(err as Error).message}`);
          }
        }
        const r = importBundle(db, bundle, config);
        io.out(chalk.green(`Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} unchanged, ${r.deduplicated} duplicates merged.`));
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
    .command('find <text>')
    .description('Find entries by keyword')
    .option('-p, --project <project>', 'Filter by project name')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('-k, --kind <kinds>', 'Comma-separated kinds: done, blocker, next')
    .option('--status <status>', 'open or resolved')
    .option('--repo <owner/name>', 'Filter by repository')
    .option('--from <date>', 'ISO date lower bound (inclusive)')
    .option('--to <date>', 'ISO date upper bound (inclusive)')
    .option('-n, --limit <n>', 'Show at most n entries')
    .action(async (text: string, options: FindCliOptions) => {
      const query = buildQuery(options, text);
      await withJournal(({ repo }) => {
        const results = repo.find(query);
        io.out(chalk.bold(`Found ${results.length} entries:\n`));
        if (results.length > 0) io.out(entryLinesText(results));
      });
    });

  program
    .command('migrate')
    .description('Import entries.json into the database, or apply a reviewed migration plan')
    .option('--plan <file>', 'Reviewed migration plan (JSON)')
    .option('--dry-run', 'Compute the changes and write nothing')
    .option('--diff <file>', 'Write the dry-run diff (markdown) to this file')
    .action(async (options: { plan?: string; dryRun?: boolean; diff?: string }) => {
      if (options.diff && !options.dryRun) throw new Error('--diff only applies with --dry-run');
      if (options.dryRun && !options.plan) throw new Error('--dry-run needs --plan <file>');
      if (options.dryRun && !options.diff) throw new Error('--dry-run needs --diff <file>');
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
          const tmp = path.join(path.dirname(path.resolve(target)), `.${path.basename(target)}.${process.pid}.tmp`);
          try {
            fs.writeFileSync(tmp, renderPlanDiff(changes));
            fs.renameSync(tmp, target);
          } finally {
            fs.rmSync(tmp, { force: true });
          }
          io.out(`Dry run: ${changes.length} entries would change. Diff written to ${target}.`);
        } else {
          if (snapshot) io.out(`Snapshot: ${snapshot}`);
          io.out(`Updated ${changes.length} entries.`);
        }
      } finally {
        journal.close();
      }
    });

  const index = program.command('index').description('Maintain the search index');
  index
    .command('rebuild')
    .description('Drop and recreate the full-text search index. Run it only when every gournal process uses a Node build with FTS5.')
    .action(async () => {
      await withJournal(({ db }) => {
        // Check FTS5 first, so a refusal does not use up the daily backup slot.
        if (!hasFts5(db)) throw new Error(NO_FTS5_MESSAGE);
        try {
          backupDbIfNeeded(db, path.join(io.home, 'gournal.db'));
        } catch (err) {
          io.err(`gournal: daily backup failed: ${(err as Error).message}`);
        }
        const { indexed } = rebuildSearchIndex(db);
        io.out(chalk.green(`Search index rebuilt: ${indexed} entries.`));
      });
    });

  program
    .command('sync')
    .description('Fetch your GitHub activity (PRs, commits, reviews) through the gh CLI')
    .option('--since <date>', 'Start date (local day or ISO timestamp). Default: the last sync.')
    .action(async (options: { since?: string }) => {
      const since = options.since === undefined ? undefined : parseSince(options.since); // fail before the journal opens
      const report = await withJournal((journal) =>
        runSync(journal, io.gh ?? execGh(), { since, auto: false, now: new Date() }));
      if (report.status === 'failed') throw new Error(report.warning ?? 'GitHub sync failed');
      const line = syncSummaryLine(report);
      io.out(report.status === 'partial' && report.warning ? `${line} ${report.warning}` : line);
    });

  program
    .command('mcp')
    .description('Start an MCP server exposing gournal entries, standup reports, and export as tools')
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
    full.err(chalk.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}
