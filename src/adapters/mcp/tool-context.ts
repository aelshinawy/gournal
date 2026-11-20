import type { McpServer } from '@modelcontextprotocol/server';
import type { GhRunner } from '../../sources';
import type { EntryWriter } from '../entry-writer';
import type { ActivityRepository, Config, Entry, EntryRepository, RepoIdentity } from '../../core';
import { entryJson } from '../../render';

export type JournalLike = { repo: EntryRepository; activity: ActivityRepository; config: Config };

export const dataResult = (text: string, structuredContent: Record<string, unknown>) =>
  ({ content: [{ type: 'text' as const, text }], structuredContent });
export const errorResult = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
type TextResult = { content: { type: 'text'; text: string }[] };
export type ToolResult = TextResult | ReturnType<typeof dataResult> | ReturnType<typeof errorResult>;
export const entryResult = (text: string, entry: Entry, notes: string[] = []) =>
  dataResult(text, { entry: entryJson(entry), notes });

/** The sync warning is the last line of the text. */
export const withWarning = (markdown: string, warning: string | null): string =>
  warning === null ? markdown : `${markdown.endsWith('\n') ? markdown : `${markdown}\n`}${warning}\n`;

export interface ToolContext {
  server: McpServer;
  /** Run a handler. Any throw becomes a tool error, never a protocol error. */
  guarded<A>(fn: (args: A, j: JournalLike) => ToolResult | Promise<ToolResult>): (args: A) => Promise<ToolResult>;
  getWriter(j: JournalLike): EntryWriter;
  identity(cwd: string): RepoIdentity;
  roots(): Promise<string[]>;
  processCwd(): string;
  /** deps.gh ?? execGh(), read on each call as today. */
  gh(): GhRunner;
}
