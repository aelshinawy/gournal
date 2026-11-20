import { z } from 'zod';
import { SyncReportSchema } from '../../render';
import { parseSince, runSync, syncSummaryLine } from '../sync';
import { dataResult, type ToolContext } from './tool-context';

export function registerSyncActivity({ server, guarded, gh }: ToolContext): void {
  server.registerTool('sync_activity',
    {
      title: 'Sync GitHub activity',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      description: 'Fetch the user\'s GitHub activity (PRs, commits, reviews) through the gh CLI, and link it to journal entries. The gh CLI must be signed in.',
      outputSchema: SyncReportSchema,
      inputSchema: { since: z.string().optional().describe('Fetch activity from this date: a local day (YYYY-MM-DD) or an ISO timestamp. Without this option, gournal fetches from the last sync.') },
    },
    guarded(async ({ since }: { since?: string }, journal) => {
      const from = since === undefined ? undefined : parseSince(since);
      const report = await runSync(journal, gh(), { since: from, auto: false, now: new Date() });
      if (report.status === 'failed') return dataResult(report.warning ?? 'GitHub sync failed', { ...report });
      const line = syncSummaryLine(report);
      return dataResult(report.warning ? `${line} ${report.warning}` : line, { ...report });
    })
  );
}
