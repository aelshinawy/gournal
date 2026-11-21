import { z } from 'zod';
import { StandupSchema, WorkLogSchema, exportCsv, exportMarkdown, standupJson, standupMarkdown, workLogJson, workLogMarkdown } from '../../render';
import { maybeAutoSync } from '../sync';
import { standupModel, workLogModel } from '../reports';
import { OPTION_TEXT } from '../shared/option-text';
import { EXPORT_DEFAULT_LIMIT, periodInput, tagsInput, type PeriodArgs } from './inputs';
import { dataResult, withWarning, type ToolContext } from './tool-context';

export function registerGetStandup({ server, guarded, gh }: ToolContext): void {
  server.registerTool('get_standup',
    {
      title: 'Get standup report',
      // Not read-only: the tool syncs GitHub and writes to the database.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      description: 'Get a standup report. It covers today unless you choose a period. Done entries come from the period. Open blockers and next items carry forward from before the period. The from and to options override yesterday, week, and month.',
      outputSchema: StandupSchema.extend({ syncWarning: z.string().nullable().describe('A warning from the automatic GitHub sync, or null. The same warning is the last line of the text result.') }),
      inputSchema: periodInput,
    },
    guarded(async (args: PeriodArgs, journal) => {
      const now = new Date();
      const syncWarning = await maybeAutoSync(journal, gh(), now);
      const model = standupModel(journal, args, now);
      return dataResult(withWarning(standupMarkdown(model), syncWarning), { ...standupJson(model), syncWarning });
    })
  );
}

export function registerGetWorkLog({ server, guarded, gh }: ToolContext): void {
  server.registerTool('get_work_log',
    {
      title: 'Get chronological work log',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      description: 'Get a work log, grouped by day. It covers today unless you choose a period. The from and to options override yesterday, week, and month.',
      outputSchema: WorkLogSchema.extend({ syncWarning: z.string().nullable().describe('A warning from the automatic GitHub sync, or null. The same warning is the last line of the text result.') }),
      inputSchema: periodInput,
    },
    guarded(async (args: PeriodArgs, journal) => {
      const now = new Date();
      const syncWarning = await maybeAutoSync(journal, gh(), now);
      const model = workLogModel(journal, args, now);
      return dataResult(withWarning(workLogMarkdown(model), syncWarning), { ...workLogJson(model), syncWarning });
    })
  );
}

export function registerExportEntries({ server, guarded }: ToolContext): void {
  server.registerTool('export_entries',
    {
      title: 'Export journal entries',
      annotations: { readOnlyHint: true },
      description: 'Export journal entries as Markdown or CSV, oldest first. When more entries exist than `limit`, a second text block carries a notice.',
      inputSchema: {
        format: z.enum(['md', 'csv']).default('md').describe(OPTION_TEXT.format),
        project: z.string().optional().describe(OPTION_TEXT.project),
        tags: tagsInput,
        from: z.string().optional().describe(OPTION_TEXT.from),
        to: z.string().optional().describe(OPTION_TEXT.to),
        limit: z.number().int().min(1).max(2000).default(EXPORT_DEFAULT_LIMIT).describe(`${OPTION_TEXT.limit} The maximum is 2000. The newest entries are kept.`),
      },
    },
    guarded(({ format, project, tags, from, to, limit }: { format: 'md' | 'csv'; project?: string; tags?: string[]; from?: string; to?: string; limit: number }, { repo }) => {
      // Fetch one extra entry to tell "exactly limit" from "more than limit".
      const found = repo.find({ project, tags, from, to, order: 'desc', limit: limit + 1 });
      const truncated = found.length > limit;
      const entries = found.slice(0, limit).reverse();
      const body = format === 'csv' ? exportCsv(entries) : exportMarkdown(entries);
      const content = [{ type: 'text' as const, text: body }];
      if (truncated) content.push({ type: 'text' as const, text: `(Showing the newest ${limit} entries. Pass limit or from/to for more.)` });
      return { content };
    })
  );
}
