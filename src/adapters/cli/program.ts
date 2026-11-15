import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import { getProjectName } from '../../git';
import { generateStandupReport } from '../../report';
import { generateWorkLog } from '../../log';
import { generateStats } from '../../stats';
import { generateCsvExport, generateMarkdownExport } from '../../export';
import { startMcpServer } from '../../mcp';
import { checkSummary } from '../../core';
import type { Kind } from '../../core';
import { toLegacy } from '../../legacy-view';
import { format } from 'date-fns';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { VERSION } from '../version';
import { clearConfirmQuestion } from './prompts';
import { openJournal } from '../../storage/journal';
import type { Journal } from '../../storage/journal';
import { exportBundle, importBundle } from '../../storage/bundle';
import { backupDbIfNeeded } from '../../storage/backup';
import { gournalHome } from '../../storage/home';
import { rebuildSearchIndex } from '../../storage/schema';
import { importLegacy, applyPlan, renderPlanDiff } from '../../storage/migrate';
import type { MigrationPlan } from '../../storage/migrate';

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  home: string;
  isTTY: boolean;
}

const KINDS: Kind[] = ['done', 'blocker', 'next'];
const shortId = (id: string): string => id.slice(-8);
const splitList = (v?: string): string[] => (v ? v.split(',').map(x => x.trim()).filter(Boolean) : []);
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
      await withJournal(({ repo }) => {
        const entry = repo.add({
          summary: check.summary,
          details: check.details,
          kind: options.kind as Kind | undefined,
          project: getProjectName(io.cwd),
          source: 'cli',
          tags: splitList(options.tags),
          resolves: splitList(options.resolves),
        });
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
    .description('Generate standup report')
    .option('-y, --yesterday', 'Include yesterday\'s entries')
    .option('-w, --week', 'Show weekly summary')
    .option('-m, --month', 'Show monthly summary')
    .option('-p, --project <project>', 'Filter by project name')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .action(async (options) => {
      await withJournal(({ repo }) => {
        const entries = repo.find({ project: options.project, tags: splitList(options.tags) }).map(e => toLegacy(e));
        io.out(generateStandupReport(entries, options));
      });
    });

  program
    .command('log')
    .description('Show a chronological work log, grouped by day (today by default)')
    .option('-y, --yesterday', 'Include yesterday\'s entries')
    .option('-w, --week', 'Show weekly log')
    .option('-m, --month', 'Show monthly log')
    .option('-p, --project <project>', 'Filter by project name')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .action(async (options) => {
      await withJournal(({ repo }) => {
        const entries = repo.find({ project: options.project, tags: splitList(options.tags) }).map(e => ({ ...toLegacy(e), id: e.id }));
        io.out(generateWorkLog(entries, options));
      });
    });

  program
    .command('stats')
    .description('Show entry counts by project/tag and your current daily streak')
    .option('-p, --project <project>', 'Filter by project name')
    .action(async (options) => {
      await withJournal(({ repo }) => {
        const entries = repo.find({ project: options.project }).map(e => toLegacy(e));
        io.out(generateStats(entries));
      });
    });

  program
    .command('tags')
    .description('List distinct tags with entry counts')
    .action(async () => {
      await withJournal(({ repo }) => {
        const counts = repo.tagCounts().map(c => [c.tag, c.count] as const);
        if (counts.length === 0) {
          io.out(chalk.yellow('No tags found.'));
          return;
        }
        counts.forEach(([tag, count]) => io.out(`${chalk.magenta(`#${tag}`)}  ${count}`));
      });
    });

  program
    .command('projects')
    .description('List distinct projects with entry counts')
    .action(async () => {
      await withJournal(({ repo }) => {
        const counts = repo.projectCounts().map(c => [c.project, c.count] as const);
        if (counts.length === 0) {
          io.out(chalk.yellow('No projects found.'));
          return;
        }
        counts.forEach(([project, count]) => io.out(`${chalk.blue(project)}  ${count}`));
      });
    });

  program
    .command('export')
    .description('Export journal entries to Markdown, CSV, or a full bundle')
    .option('-f, --format <format>', 'Output format: md, csv, or bundle', 'md')
    .option('-p, --project <project>', 'Filter by project name (md and csv only)')
    .option('-t, --tags <tags>', 'Comma-separated tags (md and csv only)')
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .action(async (options: { format: string; project?: string; tags?: string; output?: string }) => {
      const exportFormat = options.format.toLowerCase();
      if (exportFormat !== 'md' && exportFormat !== 'csv' && exportFormat !== 'bundle') {
        throw new Error(`Unknown format "${options.format}". Use md, csv, or bundle.`);
      }

      await withJournal(async ({ repo, db, config }) => {
        let output: string;
        let count: number;
        if (exportFormat === 'bundle') {
          const bundle = exportBundle(db, config);
          output = JSON.stringify(bundle, null, 2);
          count = bundle.entries.length;
        } else {
          const entries = repo.find({ project: options.project, tags: splitList(options.tags) }).map(e => toLegacy(e, { withDetails: true }));
          output = exportFormat === 'csv' ? generateCsvExport(entries) : generateMarkdownExport(entries);
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
            process.stderr.write(`gournal: daily backup failed: ${(err as Error).message}\n`);
          }
        }
        const r = importBundle(db, bundle);
        io.out(chalk.green(`Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} unchanged, ${r.deduplicated} duplicates merged.`));
        // The bundle's legacy keys are in place now. The legacy import adds only lines the bundle did not know.
        const jsonPath = path.join(io.home, 'entries.json');
        if (fs.existsSync(jsonPath)) {
          try {
            importLegacy(db, repo, config, jsonPath);
          } catch (err) {
            process.stderr.write(`gournal: legacy import failed; will retry (${(err as Error).message})\n`);
          }
        }
      }, { legacyImport: false });
    });

  program
    .command('find <query>')
    .description('Find entries by keyword')
    .option('-p, --project <project>', 'Filter by project name')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('--from <date>', 'ISO date lower bound (inclusive)')
    .option('--to <date>', 'ISO date upper bound (inclusive)')
    .action(async (query: string, options: { project?: string; tags?: string; from?: string; to?: string }) => {
      await withJournal(({ repo }) => {
        const results = repo.find({ project: options.project, tags: splitList(options.tags), from: options.from, to: options.to, text: query });

        io.out(chalk.bold(`Found ${results.length} entries:\n`));
        results.forEach(entry => {
          io.out(
            `${chalk.gray(format(new Date(entry.createdAt), 'MMM EEE dd - HH:mm'))} ` +
            `${chalk.gray(shortId(entry.id))} ` +
            `${chalk.blue(`[${entry.project}]`)} ${entry.summary} ` +
            `${entry.tags.map(t => chalk.magenta(`#${t}`)).join(' ')}`
          );
        });
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
        try {
          backupDbIfNeeded(db, path.join(io.home, 'gournal.db'));
        } catch (err) {
          process.stderr.write(`gournal: daily backup failed: ${(err as Error).message}\n`);
        }
        const { indexed } = rebuildSearchIndex(db);
        io.out(chalk.green(`Search index rebuilt: ${indexed} entries.`));
      });
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
