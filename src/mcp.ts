import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { resolveIdentity } from './sources';
import { resolveCallIdentity } from './adapters/mcp-identity';
import { generateStandupReport } from './report';
import { generateCsvExport, generateMarkdownExport } from './export';
import { generateWorkLog } from './log';
import { VERSION } from './adapters/version';
import { parseBound } from './core';
import { checkSummary, closeTags, normalizeTags, type Entry, type EntryPatch } from './core';
import type { EntryRepository } from './core/repository';
import type { Config, RepoIdentity } from './core';
import { openJournal } from './storage/journal';
import { toLegacy } from './legacy-view';
import type { ReportOptions } from './types/report-config';

export const SERVER_INSTRUCTIONS = [
  'Gournal is the user\'s work journal. Log each distinct piece of finished work with add_entry.',
  'Always pass project. summary is one line, max 120 characters. Put longer text in details.',
  'Pass cwd (your working directory) so gournal can record the repo and branch.',
  'kind is done (default), blocker (something stops you), or next (a planned next step).',
  'To close a blocker or next item, pass its id in resolves on the done entry, or call resolve_entry.',
  'Reuse existing tags (list_tags). Ticket keys and PR numbers go in refs, not tags.',
].join('\n');

const RETRY_WINDOW_MS = 10 * 60 * 1000;
const RETRY_PREFIX = 60;

type JournalLike = { repo: EntryRepository; config: Config };

const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const errorResult = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
type ToolResult = ReturnType<typeof textResult> | ReturnType<typeof errorResult>;
const shortId = (id: string) => id.slice(-8);

export interface ServerDeps {
  journal?: JournalLike;
  identity?: (cwd: string) => RepoIdentity;
  processCwd?: () => string;
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

  const isoDate = z.string().refine(v => {
    try {
      parseBound(v, 'from');
      return true;
    } catch {
      return false;
    }
  }, {
    message: 'must be a valid ISO date/timestamp',
  });

  const refSchema = z.object({
    type: z.enum(['pr', 'jira', 'commit', 'url']),
    value: z.string().min(1),
    repo: z.string().optional(),
  });

  server.registerTool(
    'add_entry',
    {
      title: 'Add journal entry',
      description: 'Add a new gournal journal entry. Pass `project` explicitly whenever you know it, and pass `cwd` so that gournal can record the repo and branch. The server process\'s own working directory is not a reliable signal for which project the calling agent is actually in. Fields come from the explicit arguments first, then from `cwd`, then from the first client root, and last from the server\'s own cwd (only when `project` is omitted). The summary must be one line of at most 120 characters. Put longer text in `details`.',
      inputSchema: {
        summary: z.string().optional().describe('One line, max 120 characters. Put longer text in `details`.'),
        message: z.string().optional().describe('Deprecated alias for summary'),
        details: z.string().optional().describe('Longer text for this entry'),
        kind: z.enum(['done', 'blocker', 'next']).optional().describe('done (default), blocker, or next'),
        project: z.string().optional().describe('Project/repo name to tag this entry with; pass it explicitly rather than relying on server cwd detection'),
        repo: z.string().optional().describe('Repository name'),
        branch: z.string().optional().describe('Git branch'),
        cwd: z.string().optional().describe('Your working directory. Gournal derives project, repo, and branch from it.'),
        agent: z.string().optional().describe('Name of the calling agent'),
        tags: z.array(z.string()).optional().describe('Optional tags for this entry. Reuse existing tags (list_tags).'),
        refs: z.array(refSchema).optional().describe('References such as PRs and ticket keys'),
        resolves: z.array(z.string()).optional().describe('Ids of open blocker or next entries that this entry closes'),
      },
    },
    guarded(async (args: {
      summary?: string; message?: string; details?: string; kind?: 'done' | 'blocker' | 'next';
      project?: string; repo?: string; branch?: string; cwd?: string; agent?: string; tags?: string[];
      refs?: { type: 'pr' | 'jira' | 'commit' | 'url'; value: string; repo?: string }[]; resolves?: string[];
    }, { repo, config }) => {
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
      const id = await resolveCallIdentity(args, { identity, roots, processCwd });
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
          project: id.project,
          repo: id.repo ?? undefined,
          branch: id.branch ?? undefined,
          agent: args.agent,
          source: 'mcp',
          tags: args.tags,
          refs: args.refs,
          resolves: [...validResolves],
        });
      });
      const lines = [`Entry ${shortId(entry.id)} added to ${entry.project}: ${entry.summary}`, ...hints, ...dropped];
      if (check.summary !== text) lines.push('Summary was too long and was split; full text is in details.');
      return textResult(lines.join('\n'));
    })
  );

  server.registerTool(
    'update_entry',
    {
      title: 'Update journal entry',
      description: 'Update fields of an existing entry. `id` is the full id or the last 8 characters.',
      inputSchema: {
        id: z.string().min(1),
        summary: z.string().optional().describe('One line, max 120 characters. Put longer text in `details`.'),
        details: z.string().optional(),
        kind: z.enum(['done', 'blocker', 'next']).optional(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
        refs: z.array(refSchema).optional(),
      },
    },
    guarded((args: {
      id: string; summary?: string; details?: string; kind?: 'done' | 'blocker' | 'next'; project?: string;
      tags?: string[]; refs?: { type: 'pr' | 'jira' | 'commit' | 'url'; value: string; repo?: string }[];
    }, { repo }) => {
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
      return textResult(`Entry ${shortId(entry.id)} updated: ${entry.summary}`);
    })
  );

  server.registerTool(
    'delete_entry',
    {
      title: 'Delete journal entry',
      description: 'Soft delete an entry. It can be restored.',
      inputSchema: { id: z.string().min(1) },
    },
    guarded(({ id }: { id: string }, { repo }) => {
      const entry = repo.softDelete(id);
      return textResult(`Entry ${shortId(entry.id)} deleted: ${entry.summary}\nrestore with gournal restore ${shortId(entry.id)}`);
    })
  );

  server.registerTool(
    'resolve_entry',
    {
      title: 'Resolve blocker or next entry',
      description: 'Mark an open blocker or next entry as resolved. Optionally pass `by`, the id of the entry that resolved it.',
      inputSchema: { id: z.string().min(1), by: z.string().optional() },
    },
    guarded(({ id, by }: { id: string; by?: string }, { repo }) => {
      const entry = repo.resolve(id, by);
      return textResult(`Entry ${shortId(entry.id)} resolved: ${entry.summary}`);
    })
  );

  server.registerTool(
    'list_entries',
    {
      title: 'List journal entries',
      description: 'List gournal journal entries (newest first), optionally filtered by project and/or a date range (inclusive, ISO timestamps). Capped at `limit` entries to avoid flooding the caller\'s context.',
      inputSchema: {
        project: z.string().optional().describe('Filter to a single project name'),
        from: isoDate.optional().describe('ISO timestamp lower bound (inclusive)'),
        to: isoDate.optional().describe('ISO timestamp upper bound (inclusive)'),
        limit: z.number().int().positive().max(500).default(50).describe('Max entries to return, newest first (default 50, max 500)'),
      },
    },
    guarded(({ project, from, to, limit }: { project?: string; from?: string; to?: string; limit: number }, { repo }) => {
      const newest: Entry[] = repo.find({ project, from, to, order: 'desc', limit });
      return textResult(JSON.stringify(newest, null, 2));
    })
  );

  server.registerTool(
    'get_standup',
    {
      title: 'Get standup report',
      description: 'Generate a gournal standup report (today by default, or yesterday/week/month), optionally filtered by project.',
      inputSchema: {
        yesterday: z.boolean().optional(),
        week: z.boolean().optional(),
        month: z.boolean().optional(),
        project: z.string().optional().describe('Filter by project name'),
      },
    },
    guarded(({ yesterday, week, month, project }: { yesterday?: boolean; week?: boolean; month?: boolean; project?: string }, { repo }) => {
      const entries = repo.find({ project }).map(e => toLegacy(e));
      const options: ReportOptions = { yesterday, week, month };
      return textResult(generateStandupReport(entries, options));
    })
  );

  server.registerTool(
    'get_work_log',
    {
      title: 'Get chronological work log',
      description: 'Generate a gournal work log grouped by day (today by default, or yesterday/week/month), optionally filtered by project and/or tags.',
      inputSchema: {
        yesterday: z.boolean().optional(),
        week: z.boolean().optional(),
        month: z.boolean().optional(),
        project: z.string().optional().describe('Filter by project name'),
        tags: z.array(z.string()).optional().describe('Filter to entries containing all of these tags'),
      },
    },
    guarded(({ yesterday, week, month, project, tags }: { yesterday?: boolean; week?: boolean; month?: boolean; project?: string; tags?: string[] }, { repo }) => {
      const entries = repo.find({ project, tags }).map(e => toLegacy(e));
      const options: ReportOptions = { yesterday, week, month };
      return textResult(generateWorkLog(entries, options));
    })
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List distinct tags',
      description: 'List distinct tags used across gournal entries with their counts, optionally filtered by project.',
      inputSchema: {
        project: z.string().optional().describe('Filter by project name'),
      },
    },
    guarded(({ project }: { project?: string }, { repo }) => {
      return textResult(JSON.stringify(repo.tagCounts({ project }), null, 2));
    })
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List distinct projects',
      description: 'List distinct projects with entry counts across the whole gournal journal.',
      inputSchema: {},
    },
    guarded((_args: Record<string, never>, { repo }) => {
      return textResult(JSON.stringify(repo.projectCounts(), null, 2));
    })
  );

  server.registerTool(
    'export_entries',
    {
      title: 'Export journal entries',
      description: 'Export gournal journal entries to Markdown or CSV, optionally filtered by project.',
      inputSchema: {
        format: z.enum(['md', 'csv']).default('md'),
        project: z.string().optional().describe('Filter by project name'),
      },
    },
    guarded(({ format, project }: { format: 'md' | 'csv'; project?: string }, { repo }) => {
      const entries = repo.find({ project }).map(e => toLegacy(e, { withDetails: true }));
      return textResult(format === 'csv' ? generateCsvExport(entries) : generateMarkdownExport(entries));
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
