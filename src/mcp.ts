import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readEntries, writeEntries } from './storage';
import { getProjectName } from './git';
import { generateStandupReport } from './report';
import { generateCsvExport, generateMarkdownExport } from './export';
import type { Entry } from './types';
import type { ReportOptions } from './types/report-config';

const filterByProject = (entries: Entry[], project?: string): Entry[] =>
  project ? entries.filter(e => e.project === project) : entries;

const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] });

export function createServer(): McpServer {
  const server = new McpServer({ name: 'gournal', version: '0.3.0' });

  const isoDate = z.string().refine(v => !isNaN(Date.parse(v)), {
    message: 'must be a valid ISO date/timestamp',
  });

  server.registerTool(
    'add_entry',
    {
      title: 'Add journal entry',
      description: 'Add a new gournal journal entry. Pass `project` explicitly whenever you know it, the server process\'s own working directory is not a reliable signal for which project the calling agent is actually in, unlike the CLI where cwd matches. Falls back to git-detecting the server\'s own cwd only when `project` is omitted.',
      inputSchema: {
        message: z.string().min(1).describe('What got done, one concise summary line'),
        project: z.string().optional().describe('Project/repo name to tag this entry with; pass it explicitly rather than relying on server cwd detection'),
        tags: z.array(z.string()).optional().describe('Optional tags for this entry'),
      },
    },
    async ({ message, project, tags }) => {
      const entry: Entry = {
        timestamp: new Date().toISOString(),
        message,
        project: project ?? getProjectName(),
        tags: tags ?? [],
      };
      const entries = await readEntries();
      entries.push(entry);
      await writeEntries(entries);
      return textResult(`Entry added to ${entry.project}: ${message}`);
    }
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
    async ({ project, from, to, limit }) => {
      let entries = filterByProject(await readEntries(), project);
      if (from) entries = entries.filter(e => e.timestamp >= from);
      if (to) entries = entries.filter(e => e.timestamp <= to);
      entries = [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
      return textResult(JSON.stringify(entries, null, 2));
    }
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
    async ({ yesterday, week, month, project }) => {
      const entries = filterByProject(await readEntries(), project);
      const options: ReportOptions = { yesterday, week, month };
      return textResult(generateStandupReport(entries, options));
    }
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
    async ({ format, project }) => {
      const entries = filterByProject(await readEntries(), project);
      const output = format === 'csv' ? generateCsvExport(entries) : generateMarkdownExport(entries);
      return textResult(output);
    }
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
