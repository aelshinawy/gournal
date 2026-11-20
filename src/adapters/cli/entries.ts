import { type Command, Option } from 'commander';
import { resolveIdentity } from '../../sources';
import { writeNoteText } from '../write-note-text';
import { kindList, parseKind, shortId, stripControl } from '../../core';
import { OPTION_TEXT } from '../shared/option-text';
import { bold, entryLinesText, green, projectCountsText, red, tagCountsText, yellow } from '../../render';
import { confirm } from './confirm';
import type { CliContext } from './context';
import { buildQuery, splitList, type FindCliOptions } from './options';

const CLEAR_QUESTION = 'Are you sure you want to clear all gournal entries?';

export function registerAdd(program: Command, ctx: CliContext): void {
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
      await ctx.withJournal((journal) => {
        const identity = resolveIdentity(ctx.io.cwd, journal.config.projectAliases);
        const { entry, notes } = ctx.writerFor(journal).add({
          summary,
          details: options.details,
          kind,
          identity,
          source: 'cli',
          tags: splitList(options.tags),
          resolves: splitList(options.resolves),
        });
        ctx.io.out(green(`✓ Entry added! (${shortId(entry.id)})`));
        if (notes.some((n) => n.type === 'split')) {
          ctx.io.out(yellow('Note: summary was long, the rest went to details.'));
        }
        for (const note of notes) if (note.type !== 'split') ctx.io.err(writeNoteText(note));
      });
    });
}

export function registerClear(program: Command, ctx: CliContext): void {
  program
    .command('clear')
    .description('Remove all journal entries after you confirm. This command needs a terminal.')
    .action(async () => {
      if (!ctx.io.isTTY) throw new Error('Not a terminal; nothing cleared.');
      let confirmed: boolean;
      try {
        confirmed = await (ctx.io.confirm ?? confirm)(red(CLEAR_QUESTION), false);
      } catch {
        throw new Error('Not a terminal; nothing cleared.');
      }
      if (!confirmed) return;
      await ctx.withJournal((journal) => {
        const count = ctx.writerFor(journal).clear();
        ctx.io.out(green(`✓ Cleared ${count} entries (restore any with gournal restore <id>).`));
      });
    });
}

export function registerUndo(program: Command, ctx: CliContext): void {
  program
    .command('undo')
    .description('Remove the last entry that you added on this device. Restore it later by id.')
    .action(async () => {
      await ctx.withJournal((journal) => {
        const removed = ctx.writerFor(journal).undo();
        if (!removed) {
          ctx.io.out(yellow('No entries to undo.'));
          return;
        }
        ctx.io.out(green(`✓ Removed: ${stripControl(removed.summary)} (restore with gournal restore ${shortId(removed.id)})`));
      });
    });
}

export function registerRestore(program: Command, ctx: CliContext): void {
  program
    .command('restore')
    .argument('<id>', 'The full id or the last 8 characters of the removed entry.')
    .description('Bring back a removed entry.')
    .action(async (id: string) => {
      await ctx.withJournal((journal) => {
        const entry = ctx.writerFor(journal).restore(id);
        ctx.io.out(green(`✓ Restored: ${stripControl(entry.summary)}`));
      });
    });
}

export function registerResolve(program: Command, ctx: CliContext): void {
  program
    .command('resolve')
    .argument('<id>', 'The full id or the last 8 characters of the entry.')
    .description('Mark an open blocker or next entry as resolved.')
    .action(async (id: string) => {
      await ctx.withJournal((journal) => {
        const entry = ctx.writerFor(journal).resolve(id);
        ctx.io.out(green(`✓ Resolved: ${stripControl(entry.summary)}`));
      });
    });
}

export function registerTags(program: Command, ctx: CliContext): void {
  program
    .command('tags')
    .description('List every tag that you use, with the number of entries for each tag.')
    .action(async () => {
      await ctx.withJournal(({ repo }) => {
        ctx.io.out(tagCountsText(repo.tagCounts()));
      });
    });
}

export function registerProjects(program: Command, ctx: CliContext): void {
  program
    .command('projects')
    .description('List every project that you log to, with the number of entries for each project.')
    .action(async () => {
      await ctx.withJournal(({ repo }) => {
        ctx.io.out(projectCountsText(repo.projectCounts()));
      });
    });
}

export function registerFind(program: Command, ctx: CliContext): void {
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
      await ctx.withJournal(({ repo }) => {
        const results = repo.find(query);
        ctx.io.out(bold(`Found ${results.length} entries:\n`));
        if (results.length > 0) ctx.io.out(entryLinesText(results));
      });
    });
}
