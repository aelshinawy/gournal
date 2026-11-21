import fs from 'fs';
import type { Command } from 'commander';
import { green } from '../../render';
import { importBundle, hasFts5, rebuildSearchIndex } from '../../storage';
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
        const { db, config } = journal;
        // An empty database has nothing to protect. It must not take the day's backup slot.
        if (journal.repo.find({ includeDeleted: true, limit: 1 }).length > 0) {
          ctx.backupWithWarning(journal);
        }
        const r = importBundle(db, bundle, config);
        if (r.warning) ctx.io.err(`gournal: ${r.warning}`);
        ctx.io.out(green(`Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} unchanged.`));
      });
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
