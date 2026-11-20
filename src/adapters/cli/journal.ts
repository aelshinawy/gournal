import fs from 'fs';
import path from 'path';
import type { Command } from 'commander';
import { green } from '../../render';
import { openJournal, importBundle, hasFts5, rebuildSearchIndex, importLegacy, applyPlan, renderPlanDiff, writePrivateFile, assertTargetDir, type MigrationPlan } from '../../storage';
import type { CliContext } from './context';

const NO_FTS5_MESSAGE = 'This Node build has no FTS5; the search index cannot be rebuilt.';

export function registerImport(program: Command, ctx: CliContext): void {
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

export function registerMigrate(program: Command, ctx: CliContext): void {
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

export function registerIndex(program: Command, ctx: CliContext): void {
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
