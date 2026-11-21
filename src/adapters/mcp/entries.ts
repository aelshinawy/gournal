import { z } from 'zod';
import { STATUSES, SOURCES, kindList, shortId, type Kind, type Query, type Ref } from '../../core';
import { EntryListSchema, EntryResultSchema, ProjectCountsSchema, TagCountsSchema, entriesMarkdown, entryJson } from '../../render';
import { writeNoteText } from '../write-note-text';
import { OPTION_TEXT } from '../shared/option-text';
import { resolveCallIdentity } from './identity';
import {
  CAPS, KIND, FIND_DEFAULT_LIMIT, LIST_DEFAULT_LIMIT, SUMMARY_TEXT,
  entryRefs, entryTags, shortText, tagsInput,
} from './inputs';
import { dataResult, entryResult, errorResult, type ToolContext } from './tool-context';

export function registerAddEntry({ server, guarded, getWriter, identity, roots, processCwd }: ToolContext): void {
  server.registerTool('add_entry',
    {
      title: 'Add journal entry',
      annotations: { destructiveHint: false },
      description: 'Add a journal entry. Pass `project` explicitly whenever you know it, and pass `cwd` so that gournal can record the repo and branch. The server process\'s own working directory is not a reliable signal for which project the calling agent is actually in. Fields come from the explicit arguments first, then from `cwd`, then from the first client root, and last from the server\'s own cwd (only when `project` is omitted).',
      outputSchema: EntryResultSchema,
      inputSchema: {
        summary: z.string().max(CAPS.summary).optional().describe(SUMMARY_TEXT),
        message: z.string().max(CAPS.summary).optional().describe('Deprecated alias for summary. Use summary instead. It will be removed in 0.12.0.'),
        details: z.string().max(CAPS.details).optional().describe('Longer text for this entry. Use it when the summary needs more room.'),
        kind: KIND.default('done').describe(`Entry kind: ${kindList({ notes: true, defaultKind: 'done' })}.`),
        project: shortText().optional().describe('Project name for this entry. Pass it explicitly. Do not rely on the server working directory.'),
        repo: shortText().optional().describe('Repository name, for example owner/name.'),
        branch: shortText().optional().describe('Git branch name.'),
        cwd: z.string().max(CAPS.cwd).optional().describe('Your working directory. Gournal derives project, repo, and branch from it.'),
        agent: shortText().optional().describe('Name of the calling agent. Gournal stores it with the entry.'),
        tags: entryTags('Tags for this entry. Reuse existing tags (list_tags).'),
        refs: entryRefs('References such as PRs and ticket keys. Put them here, not in tags.'),
        resolves: z.array(z.string().max(CAPS.id)).max(CAPS.resolves).optional().describe('Ids of open blocker or next entries that this entry closes. Use the full id or the last 8 characters. The server drops an unknown id, and the result carries a note.'),
      },
    },
    guarded(async (args: {
      summary?: string; message?: string; details?: string; kind?: Kind;
      project?: string; repo?: string; branch?: string; cwd?: string; agent?: string; tags?: string[];
      refs?: Ref[]; resolves?: string[];
    }, journal) => {
      const raw = args.summary ?? args.message;
      if (raw === undefined) return errorResult('summary is required');
      const identityOfCall = await resolveCallIdentity(args, { identity, roots, processCwd });
      const { entry, notes } = getWriter(journal).add({
        summary: raw, details: args.details, kind: args.kind, identity: identityOfCall, source: 'mcp',
        agent: args.agent, tags: args.tags, refs: args.refs, resolves: args.resolves,
      });
      const lines = notes.map(writeNoteText);
      return entryResult([`Entry ${shortId(entry.id)} added to ${entry.project}: ${entry.summary}`, ...lines].join('\n'), entry, lines);
    })
  );
}

export function registerUpdateEntry({ server, guarded, getWriter }: ToolContext): void {
  server.registerTool('update_entry',
    {
      title: 'Update journal entry',
      annotations: { destructiveHint: true },
      description: 'Change fields of an existing entry. Fields that you omit stay as they are.',
      outputSchema: EntryResultSchema,
      inputSchema: {
        id: z.string().min(1).max(CAPS.id).describe('Full id or the last 8 characters of the entry.'),
        summary: z.string().max(CAPS.summary).optional().describe(SUMMARY_TEXT),
        details: z.string().max(CAPS.details).optional().describe('New longer text for the entry.'),
        kind: KIND.optional().describe(`New kind: ${kindList()}. A change of kind sets the status to open (none for done) and clears the resolution.`),
        project: shortText().optional().describe('New project name.'),
        tags: entryTags('New tags. They replace the current tags.'),
        refs: entryRefs('New references. They replace the current references. If you also pass `tags`, references that come from ticket-style tags are added to them.'),
      },
    },
    guarded((args: {
      id: string; summary?: string; details?: string; kind?: Kind; project?: string;
      tags?: string[]; refs?: Ref[];
    }, journal) => {
      const { entry, notes } = getWriter(journal).update(args.id, {
        summary: args.summary, details: args.details, kind: args.kind, project: args.project, tags: args.tags, refs: args.refs,
      });
      const lines = notes.map(writeNoteText);
      return entryResult([`Entry ${shortId(entry.id)} updated: ${entry.summary}`, ...lines].join('\n'), entry, lines);
    })
  );
}

export function registerDeleteEntry({ server, guarded, getWriter }: ToolContext): void {
  server.registerTool('delete_entry',
    {
      title: 'Remove journal entry',
      annotations: { destructiveHint: true },
      description: 'Remove an entry. The entry stays in the database, so you can restore it with the CLI command `gournal restore <id>`.',
      outputSchema: EntryResultSchema,
      inputSchema: { id: z.string().min(1).max(CAPS.id).describe('Full id or the last 8 characters of the entry.') },
    },
    guarded(({ id }: { id: string }, journal) => {
      const entry = getWriter(journal).delete(id);
      return entryResult(`Entry ${shortId(entry.id)} removed: ${entry.summary}\nrestore with gournal restore ${shortId(entry.id)}`, entry);
    })
  );
}

export function registerResolveEntry({ server, guarded, getWriter }: ToolContext): void {
  server.registerTool('resolve_entry',
    {
      title: 'Resolve blocker or next entry',
      annotations: { destructiveHint: false },
      description: 'Mark an open blocker or next entry as resolved.',
      outputSchema: EntryResultSchema,
      inputSchema: {
        id: z.string().min(1).max(CAPS.id).describe('Full id or the last 8 characters of the open blocker or next entry.'),
        by: z.string().max(CAPS.id).optional().describe('Id of the entry that resolved it.'),
      },
    },
    guarded(({ id, by }: { id: string; by?: string }, journal) => {
      const entry = getWriter(journal).resolve(id, by);
      return entryResult(`Entry ${shortId(entry.id)} resolved: ${entry.summary}`, entry);
    })
  );
}

export function registerFindEntries({ server, guarded }: ToolContext): void {
  server.registerTool('find_entries',
    {
      title: 'Find journal entries',
      annotations: { readOnlyHint: true },
      description: 'Search journal entries. Every filter is optional, and filters combine.',
      outputSchema: EntryListSchema,
      inputSchema: {
        project: z.string().optional().describe(OPTION_TEXT.project),
        repo: z.string().optional().describe(OPTION_TEXT.repo),
        tags: tagsInput,
        text: z.string().max(CAPS.findText).optional().describe('Search words. Every word must match.'),
        kind: z.array(KIND).optional().describe(OPTION_TEXT.kind),
        status: z.enum(STATUSES).optional().describe(OPTION_TEXT.status),
        source: z.enum(SOURCES).optional().describe('Only entries that came from this source.'),
        from: z.string().optional().describe(OPTION_TEXT.from),
        to: z.string().optional().describe(OPTION_TEXT.to),
        limit: z.number().int().min(1).max(500).default(FIND_DEFAULT_LIMIT).describe(`${OPTION_TEXT.limit} The maximum is 500.`),
        order: z.enum(['asc', 'desc']).default('desc').describe('desc puts the newest entries first. asc puts the oldest first.'),
        includeDeleted: z.boolean().optional().describe('Also return entries that you removed.'),
      },
    },
    guarded((args: Query & { limit: number; order: 'asc' | 'desc' }, { repo }) => {
      const entries = repo.find(args);
      return dataResult(entriesMarkdown(entries), { entries: entries.map(entryJson), count: entries.length });
    })
  );
}

export function registerListEntries({ server, guarded }: ToolContext): void {
  server.registerTool('list_entries',
    {
      title: 'List journal entries',
      annotations: { readOnlyHint: true },
      description: 'Deprecated: use find_entries (same filters and more). This tool will be removed in 0.12.0. List journal entries, newest first. The text result is JSON. Pass a low `limit` so that the result does not flood your context.',
      outputSchema: EntryListSchema,
      inputSchema: {
        project: z.string().optional().describe(OPTION_TEXT.project),
        tags: tagsInput,
        from: z.string().optional().describe(OPTION_TEXT.from),
        to: z.string().optional().describe(OPTION_TEXT.to),
        limit: z.number().int().positive().max(500).default(LIST_DEFAULT_LIMIT).describe(`${OPTION_TEXT.limit} The newest come first. The maximum is 500.`),
      },
    },
    guarded(({ project, tags, from, to, limit }: { project?: string; tags?: string[]; from?: string; to?: string; limit: number }, { repo }) => {
      const newest = repo.find({ project, tags, from, to, order: 'desc', limit });
      return dataResult(JSON.stringify(newest, null, 2), { entries: newest.map(entryJson), count: newest.length });
    })
  );
}

export function registerListTags({ server, guarded }: ToolContext): void {
  server.registerTool('list_tags',
    {
      title: 'List distinct tags',
      annotations: { readOnlyHint: true },
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
}

export function registerListProjects({ server, guarded }: ToolContext): void {
  server.registerTool('list_projects',
    {
      title: 'List distinct projects',
      annotations: { readOnlyHint: true },
      description: 'List every project in the journal, with the number of entries for each project.',
      outputSchema: ProjectCountsSchema,
      inputSchema: {},
    },
    guarded((_args: Record<string, never>, { repo }) => {
      const projects = repo.projectCounts();
      return dataResult(JSON.stringify(projects, null, 2), { projects });
    })
  );
}
