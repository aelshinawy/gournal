import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { execGh, resolveIdentity, type GhRunner } from '../../sources';
import { maybeAutoSync, parseSince, relinkAfterWrite, runSync, syncSummaryLine } from '../sync';
import { resolveCallIdentity } from './identity';
import { VERSION } from '../version';
import { KINDS, OPTION_TEXT, STATUSES, checkSummary, closeTags, normalizeTags, shortId } from '../../core';
import type { ActivityRepository, Config, Entry, EntryPatch, EntryRepository, Query, RepoIdentity } from '../../core';
import {
  EntryListSchema, EntryResultSchema, ProjectCountsSchema, StandupSchema, SyncReportSchema, TagCountsSchema, WorkLogSchema,
  entriesMarkdown, entryJson, exportCsv, exportMarkdown, standupJson, standupMarkdown, workLogJson, workLogMarkdown,
} from '../../render';
import { openJournal } from '../../storage';
import { standupModel, workLogModel } from '../reports';

export const SERVER_INSTRUCTIONS = [
  'Gournal is the user\'s work journal. Log each distinct piece of finished work with add_entry.',
  'Always pass project. summary is one line, max 120 characters. Put longer text in details.',
  'Pass cwd (your working directory) so gournal can record the repo and branch.',
  'kind is done (default), blocker (something stops you), or next (a planned next step).',
  'To close a blocker or next item, pass its id in resolves on the done entry, or call resolve_entry.',
  'Reuse existing tags (list_tags). Ticket keys and PR numbers go in refs, not tags.',
  'Call sync_activity to fetch the user\'s GitHub activity. Report tools already sync when the data is stale.',
].join('\n');

const RETRY_WINDOW_MS = 10 * 60 * 1000;
const RETRY_PREFIX = 60;

type JournalLike = { repo: EntryRepository; activity: ActivityRepository; config: Config };

const EXPORT_DEFAULT_LIMIT = 200;
const FIND_DEFAULT_LIMIT = 50;

const dataResult = (text: string, structuredContent: Record<string, unknown>) =>
  ({ content: [{ type: 'text' as const, text }], structuredContent });
const errorResult = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
type TextResult = { content: { type: 'text'; text: string }[] };
type ToolResult = TextResult | ReturnType<typeof dataResult> | ReturnType<typeof errorResult>;
const entryResult = (text: string, entry: Entry, notes: string[] = []) =>
  dataResult(text, { entry: entryJson(entry), notes });

/** The sync warning is the last line of the text. */
const withWarning = (markdown: string, warning: string | null): string =>
  warning === null ? markdown : `${markdown.endsWith('\n') ? markdown : `${markdown}\n`}${warning}\n`;

const KIND = z.enum(KINDS);

export interface ServerDeps {
  journal?: JournalLike;
  identity?: (cwd: string) => RepoIdentity;
  processCwd?: () => string;
  /** Test seam. The default runs the real gh. */
  gh?: GhRunner;
}

const ROOTS_TIMEOUT_MS = 1000;

export function createServer(deps: ServerDeps = {}): McpServer {
  const server = new McpServer({ name: 'gournal', version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  let opened: JournalLike | undefined = deps.journal;
  const getJournal = (): JournalLike => {
    if (!opened) {
      const j = openJournal();
      process.once('exit', () => { try { j.close(); } catch { /* ignore */ } });
      opened = j;
    }
    return opened;
  };

  const identity = deps.identity ?? ((cwd: string) => resolveIdentity(cwd, getJournal().config.projectAliases));
  const processCwd = deps.processCwd ?? (() => process.cwd());
  const roots = async (): Promise<string[]> => {
    try {
      if (!server.server.getClientCapabilities()?.roots) return [];
      const { roots: list } = await server.server.listRoots(undefined, { timeout: ROOTS_TIMEOUT_MS });
      const paths: string[] = [];
      for (const r of list) {
        try { paths.push(fileURLToPath(r.uri)); } catch { /* skip a root that is not a file URI */ }
      }
      return paths;
    } catch {
      return [];
    }
  };

  // Rejected summary to the time of rejection. Lives as long as the server.
  const rejected = new Map<string, number>();
  const isRetry = (summary: string, now: number): boolean => {
    for (const [text, at] of rejected) if (now - at > RETRY_WINDOW_MS) rejected.delete(text);
    const head = (s: string) => Array.from(s).slice(0, RETRY_PREFIX).join('');
    for (const text of rejected.keys()) {
      if (summary === text || summary.startsWith(head(text))) return true;
    }
    return false;
  };

  /** Run a handler. Any throw becomes a tool error, never a protocol error. */
  const guarded = <A>(fn: (args: A, j: JournalLike) => ToolResult | Promise<ToolResult>) =>
    async (args: A) => {
      try {
        return await fn(args, getJournal());
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    };

  const refSchema = z.object({
    type: z.enum(['pr', 'jira', 'commit', 'url']).describe('Kind of reference: a PR, a Jira key, a commit, or a URL.'),
    value: z.string().min(1).describe('The PR number, ticket key, commit hash, or URL.'),
    repo: z.string().optional().describe('Repository (owner/name) of the PR or commit.'),
  });

  server.registerTool(
    'add_entry',
    {
      title: 'Add journal entry',
      description: 'Add a journal entry. Pass `project` explicitly whenever you know it, and pass `cwd` so that gournal can record the repo and branch. The server process\'s own working directory is not a reliable signal for which project the calling agent is actually in. Fields come from the explicit arguments first, then from `cwd`, then from the first client root, and last from the server\'s own cwd (only when `project` is omitted).',
      outputSchema: EntryResultSchema,
      inputSchema: {
        summary: z.string().optional().describe('One line, max 120 characters. A longer summary is split into details when you pass `details`, or when you retry a summary with the same first 60 characters within 10 minutes. Otherwise the server rejects it.'),
        message: z.string().optional().describe('Deprecated alias for summary. Use summary instead.'),
        details: z.string().optional().describe('Longer text for this entry. Use it when the summary needs more room.'),
        kind: KIND.default('done').describe('Entry kind: done (default), blocker (something stops you), or next (a planned step).'),
        project: z.string().optional().describe('Project name for this entry. Pass it explicitly. Do not rely on the server working directory.'),
        repo: z.string().optional().describe('Repository name, for example owner/name.'),
        branch: z.string().optional().describe('Git branch name.'),
        cwd: z.string().optional().describe('Your working directory. Gournal derives project, repo, and branch from it.'),
        agent: z.string().optional().describe('Name of the calling agent. Gournal stores it with the entry.'),
        tags: z.array(z.string()).optional().describe('Tags for this entry. Reuse existing tags (list_tags).'),
        refs: z.array(refSchema).optional().describe('References such as PRs and ticket keys. Put them here, not in tags.'),
        resolves: z.array(z.string()).optional().describe('Ids of open blocker or next entries that this entry closes. Use the full id or the last 8 characters. The server drops an unknown id, and the result carries a note.'),
      },
    },
    guarded(async (args: {
      summary?: string; message?: string; details?: string; kind?: 'done' | 'blocker' | 'next';
      project?: string; repo?: string; branch?: string; cwd?: string; agent?: string; tags?: string[];
      refs?: { type: 'pr' | 'jira' | 'commit' | 'url'; value: string; repo?: string }[]; resolves?: string[];
    }, journal) => {
      const { repo, config } = journal;
      const raw = args.summary ?? args.message;
      if (raw === undefined) return errorResult('summary is required');
      const now = Date.now();
      const text = raw.trim();
      const retry = isRetry(text, now);
      const check = checkSummary(raw, args.details, { allowSplit: args.details !== undefined || retry });
      if (!check.ok) {
        rejected.set(text, now);
        return errorResult(check.error);
      }
      const hints: string[] = [];
      if (args.tags?.length) {
        const known = new Set(repo.allTags());
        const { tags } = normalizeTags(args.tags, config.tagAliases, { ticketPrefixes: config.ticketPrefixes });
        for (const tag of tags) {
          if (known.has(tag)) continue;
          const close = closeTags(tag, [...known]);
          if (close.length) hints.push(`New tag "${tag}". Close existing tags: ${close.join(', ')}`);
        }
      }
      const identityOfCall = await resolveCallIdentity(args, { identity, roots, processCwd });
      // A bad resolves id never stops the entry. Drop it and report it.
      // The check and the add share one transaction, so a target cannot change in between.
      const dropped: string[] = [];
      const entry = repo.transaction(() => {
        const validResolves = new Set<string>();
        for (const id of args.resolves ?? []) {
          try {
            const target = repo.get(id);
            if (!target) throw new Error(`No entry with id "${id}"`);
            if ((target.kind !== 'blocker' && target.kind !== 'next') || target.status !== 'open') {
              throw new Error('only an open blocker or next can be resolved');
            }
            validResolves.add(target.id);
          } catch (err) {
            dropped.push(`Could not resolve ${id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return repo.add({
          summary: check.summary,
          details: check.details,
          kind: args.kind,
          project: identityOfCall.project,
          repo: identityOfCall.repo ?? undefined,
          branch: identityOfCall.branch ?? undefined,
          agent: args.agent,
          source: 'mcp',
          tags: args.tags,
          refs: args.refs,
          resolves: [...validResolves],
        });
      });
      relinkAfterWrite(journal, [entry.id]);
      const lines = [`Entry ${shortId(entry.id)} added to ${entry.project}: ${entry.summary}`, ...hints, ...dropped];
      if (check.summary !== text) lines.push('Summary was too long and was split; full text is in details.');
      return entryResult(lines.join('\n'), entry, lines.slice(1));
    })
  );

  server.registerTool(
    'update_entry',
    {
      title: 'Update journal entry',
      description: 'Change fields of an existing entry. Fields that you omit stay as they are.',
      outputSchema: EntryResultSchema,
      inputSchema: {
        id: z.string().min(1).describe('Full id or the last 8 characters of the entry.'),
        summary: z.string().optional().describe('One line, max 120 characters. Put longer text in `details`.'),
        details: z.string().optional().describe('New longer text for the entry.'),
        kind: KIND.optional().describe('New kind: done, blocker, or next. A change of kind sets the status to open (none for done) and clears the resolution.'),
        project: z.string().optional().describe('New project name.'),
        tags: z.array(z.string()).optional().describe('New tags. They replace the current tags.'),
        refs: z.array(refSchema).optional().describe('New references. They replace the current references. If you also pass `tags`, references that come from ticket-style tags are added to them.'),
      },
    },
    guarded((args: {
      id: string; summary?: string; details?: string; kind?: 'done' | 'blocker' | 'next'; project?: string;
      tags?: string[]; refs?: { type: 'pr' | 'jira' | 'commit' | 'url'; value: string; repo?: string }[];
    }, journal) => {
      const { repo } = journal;
      const patch: EntryPatch = {};
      if (args.summary !== undefined) {
        const check = checkSummary(args.summary, args.details, { allowSplit: args.details !== undefined });
        if (!check.ok) return errorResult(check.error);
        patch.summary = check.summary;
        if (check.details !== null) patch.details = check.details;
      } else if (args.details !== undefined) {
        patch.details = args.details;
      }
      if (args.kind !== undefined) patch.kind = args.kind;
      if (args.project !== undefined) patch.project = args.project;
      if (args.tags !== undefined) patch.tags = args.tags;
      if (args.refs !== undefined) patch.refs = args.refs;
      const entry = repo.update(args.id, patch);
      relinkAfterWrite(journal, [entry.id]);
      return entryResult(`Entry ${shortId(entry.id)} updated: ${entry.summary}`, entry);
    })
  );

  server.registerTool(
    'delete_entry',
    {
      title: 'Delete journal entry',
      description: 'Delete an entry. The entry stays in the database, so you can restore it with the CLI command `gournal restore <id>`.',
      outputSchema: EntryResultSchema,
      inputSchema: { id: z.string().min(1).describe('Full id or the last 8 characters of the entry.') },
    },
    guarded(({ id }: { id: string }, { repo }) => {
      const entry = repo.softDelete(id);
      return entryResult(`Entry ${shortId(entry.id)} deleted: ${entry.summary}\nrestore with gournal restore ${shortId(entry.id)}`, entry);
    })
  );

  server.registerTool(
    'resolve_entry',
    {
      title: 'Resolve blocker or next entry',
      description: 'Mark an open blocker or next entry as resolved.',
      outputSchema: EntryResultSchema,
      inputSchema: {
        id: z.string().min(1).describe('Full id or the last 8 characters of the open blocker or next entry.'),
        by: z.string().optional().describe('Id of the entry that resolved it.'),
      },
    },
    guarded(({ id, by }: { id: string; by?: string }, { repo }) => {
      const entry = repo.resolve(id, by);
      return entryResult(`Entry ${shortId(entry.id)} resolved: ${entry.summary}`, entry);
    })
  );

  const tagsInput = z.array(z.string()).optional().describe(OPTION_TEXT.tags);
  const periodInput = {
    yesterday: z.boolean().optional().describe(OPTION_TEXT.yesterday),
    week: z.boolean().optional().describe(OPTION_TEXT.week),
    month: z.boolean().optional().describe(OPTION_TEXT.month),
    from: z.string().optional().describe(OPTION_TEXT.from),
    to: z.string().optional().describe(OPTION_TEXT.to),
    project: z.string().optional().describe(OPTION_TEXT.project),
    repo: z.string().optional().describe(OPTION_TEXT.repo),
    tags: tagsInput,
  };
  type PeriodArgs = {
    yesterday?: boolean; week?: boolean; month?: boolean; from?: string; to?: string;
    project?: string; repo?: string; tags?: string[];
  };

  server.registerTool(
    'find_entries',
    {
      title: 'Find journal entries',
      description: 'Search journal entries. Every filter is optional, and filters combine.',
      outputSchema: EntryListSchema,
      inputSchema: {
        project: z.string().optional().describe(OPTION_TEXT.project),
        repo: z.string().optional().describe(OPTION_TEXT.repo),
        tags: tagsInput,
        text: z.string().optional().describe('Search words. Every word must match.'),
        kind: z.array(KIND).optional().describe(OPTION_TEXT.kind),
        status: z.enum(STATUSES).optional().describe(OPTION_TEXT.status),
        source: z.enum(['cli', 'mcp', 'migration']).optional().describe('Only entries that came from this source.'),
        from: z.string().optional().describe(OPTION_TEXT.from),
        to: z.string().optional().describe(OPTION_TEXT.to),
        limit: z.number().int().min(1).max(500).default(FIND_DEFAULT_LIMIT).describe(`${OPTION_TEXT.limit} The maximum is 500.`),
        order: z.enum(['asc', 'desc']).default('desc').describe('desc puts the newest entries first. asc puts the oldest first.'),
        includeDeleted: z.boolean().optional().describe('Also return entries that you deleted.'),
      },
    },
    guarded((args: Query & { limit: number; order: 'asc' | 'desc' }, { repo }) => {
      const entries = repo.find(args);
      return dataResult(entriesMarkdown(entries), { entries: entries.map(entryJson), count: entries.length });
    })
  );

  server.registerTool(
    'list_entries',
    {
      title: 'List journal entries',
      description: 'List journal entries, newest first. The text result is JSON. Pass a low `limit` so that the result does not flood your context.',
      outputSchema: EntryListSchema,
      inputSchema: {
        project: z.string().optional().describe(OPTION_TEXT.project),
        tags: tagsInput,
        from: z.string().optional().describe(OPTION_TEXT.from),
        to: z.string().optional().describe(OPTION_TEXT.to),
        limit: z.number().int().positive().max(500).default(50).describe(`${OPTION_TEXT.limit} The newest come first. The maximum is 500.`),
      },
    },
    guarded(({ project, tags, from, to, limit }: { project?: string; tags?: string[]; from?: string; to?: string; limit: number }, { repo }) => {
      const newest = repo.find({ project, tags, from, to, order: 'desc', limit });
      return dataResult(JSON.stringify(newest, null, 2), { entries: newest.map(entryJson), count: newest.length });
    })
  );

  server.registerTool(
    'get_standup',
    {
      title: 'Get standup report',
      description: 'Get a standup report. It covers today unless you choose a period. Done entries come from the period. Open blockers and next items carry forward from before the period. The from and to options override yesterday, week, and month.',
      outputSchema: StandupSchema.extend({ syncWarning: z.string().nullable().describe('A warning from the automatic GitHub sync, or null. The same warning is the last line of the text result.') }),
      inputSchema: periodInput,
    },
    guarded(async (args: PeriodArgs, journal) => {
      const syncWarning = await maybeAutoSync(journal, deps.gh ?? execGh(), new Date());
      const model = standupModel(journal, args, new Date());
      return dataResult(withWarning(standupMarkdown(model), syncWarning), { ...standupJson(model), syncWarning });
    })
  );

  server.registerTool(
    'get_work_log',
    {
      title: 'Get chronological work log',
      description: 'Get a work log, grouped by day. It covers today unless you choose a period. The from and to options override yesterday, week, and month.',
      outputSchema: WorkLogSchema.extend({ syncWarning: z.string().nullable().describe('A warning from the automatic GitHub sync, or null. The same warning is the last line of the text result.') }),
      inputSchema: periodInput,
    },
    guarded(async (args: PeriodArgs, journal) => {
      const syncWarning = await maybeAutoSync(journal, deps.gh ?? execGh(), new Date());
      const model = workLogModel(journal, args, new Date());
      return dataResult(withWarning(workLogMarkdown(model), syncWarning), { ...workLogJson(model), syncWarning });
    })
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List distinct tags',
      description: 'List every tag in use, with the number of entries for each tag. Call this before you add tags, to reuse existing ones.',
      outputSchema: TagCountsSchema,
      inputSchema: {
        project: z.string().optional().describe('Count tags of this project only.'),
      },
    },
    guarded(({ project }: { project?: string }, { repo }) => {
      const tags = repo.tagCounts({ project });
      return dataResult(JSON.stringify(tags, null, 2), { tags });
    })
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List distinct projects',
      description: 'List every project in the journal, with the number of entries for each project.',
      outputSchema: ProjectCountsSchema,
      inputSchema: {},
    },
    guarded((_args: Record<string, never>, { repo }) => {
      const projects = repo.projectCounts();
      return dataResult(JSON.stringify(projects, null, 2), { projects });
    })
  );

  server.registerTool(
    'export_entries',
    {
      title: 'Export journal entries',
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

  server.registerTool(
    'sync_activity',
    {
      title: 'Sync GitHub activity',
      description: 'Fetch the user\'s GitHub activity (PRs, commits, reviews) through the gh CLI, and link it to journal entries. The gh CLI must be signed in.',
      outputSchema: SyncReportSchema,
      inputSchema: { since: z.string().optional().describe('Fetch activity from this date: a local day (YYYY-MM-DD) or an ISO timestamp. Without this option, gournal fetches from the last sync.') },
    },
    guarded(async ({ since }: { since?: string }, journal) => {
      const from = since === undefined ? undefined : parseSince(since);
      const report = await runSync(journal, deps.gh ?? execGh(), { since: from, auto: false, now: new Date() });
      if (report.status === 'failed') return dataResult(report.warning ?? 'GitHub sync failed', { ...report });
      const line = syncSummaryLine(report);
      return dataResult(report.warning ? `${line} ${report.warning}` : line, { ...report });
    })
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  // The journal opens on first tool use and closes on process exit.
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
