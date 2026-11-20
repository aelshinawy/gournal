import { z } from 'zod';
import { KINDS, REF_TYPES } from '../../core';
import { OPTION_TEXT } from '../shared/option-text';

export const SUMMARY_TEXT = 'One line, max 120 characters. A longer summary is split into details when you pass `details`, or when you retry a summary with the same first 60 characters within 10 minutes. Otherwise the server rejects it.';

export const EXPORT_DEFAULT_LIMIT = 200;
export const FIND_DEFAULT_LIMIT = 50;
export const LIST_DEFAULT_LIMIT = 50;

export const KIND = z.enum(KINDS);

/** Input caps for the tools that write entries. add_entry and update_entry share them. */
export const CAPS = {
  summary: 1000, details: 20000, short: 200, cwd: 4096, tag: 64, tags: 20, refs: 20, refValue: 500, resolves: 50, id: 64, findText: 500,
} as const;

const refSchema = z.object({
  type: z.enum(REF_TYPES).describe('Kind of reference: a PR, a Jira key, a commit, or a URL.'),
  value: z.string().min(1).max(CAPS.refValue).describe('The PR number, ticket key, commit hash, or URL.'),
  repo: z.string().max(CAPS.short).optional().describe('Repository (owner/name) of the PR or commit.'),
});
export const shortText = () => z.string().max(CAPS.short);
export const entryTags = (description: string) => z.array(z.string().max(CAPS.tag)).max(CAPS.tags).optional().describe(description);
export const entryRefs = (description: string) => z.array(refSchema).max(CAPS.refs).optional().describe(description);

export const tagsInput = z.array(z.string()).optional().describe(OPTION_TEXT.tags);
export const periodInput = {
  yesterday: z.boolean().optional().describe(OPTION_TEXT.yesterday),
  week: z.boolean().optional().describe(OPTION_TEXT.week),
  month: z.boolean().optional().describe(OPTION_TEXT.month),
  from: z.string().optional().describe(OPTION_TEXT.from),
  to: z.string().optional().describe(OPTION_TEXT.to),
  project: z.string().optional().describe(OPTION_TEXT.project),
  repo: z.string().optional().describe(OPTION_TEXT.repo),
  tags: tagsInput,
};
export type PeriodArgs = {
  yesterday?: boolean; week?: boolean; month?: boolean; from?: string; to?: string;
  project?: string; repo?: string; tags?: string[];
};
