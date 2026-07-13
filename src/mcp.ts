import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readEntries } from './storage';
import { generateStandupReport } from './report';
import { generateCsvExport, generateMarkdownExport } from './export';
import type { Entry } from './types';
import type { ReportOptions } from './types/report-config';

const filterByProject = (entries: Entry[], project?: string): Entry[] =>
  project ? entries.filter(e => e.project === project) : entries;

const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] });

export function createServer(): McpServer {
  const server = new McpServer({ name: 'gournal', version: '0.3.0' });

  server.registerTool(
    'list_entries',
    {
      title: 'List journal entries',
      description: 'List gournal journal entries, optionally filtered by project and/or a date range (inclusive, ISO timestamps).',
      inputSchema: {
        project: z.string().optional().describe('Filter to a single project name'),
        from: z.string().optional().describe('ISO timestamp lower bound (inclusive)'),
        to: z.string().optional().describe('ISO timestamp upper bound (inclusive)'),
      },
    },
    async ({ project, from, to }) => {
      let entries = filterByProject(await readEntries(), project);
      if (from) entries = entries.filter(e => e.timestamp >= from);
      if (to) entries = entries.filter(e => e.timestamp <= to);
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
    'get_monthly_summary',
    {
      title: 'Get monthly summary',
      description: 'Generate the gournal monthly standup summary, optionally filtered by project.',
      inputSchema: {
        project: z.string().optional().describe('Filter by project name'),
      },
    },
    async ({ project }) => {
      const entries = filterByProject(await readEntries(), project);
      return textResult(generateStandupReport(entries, { month: true }));
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
