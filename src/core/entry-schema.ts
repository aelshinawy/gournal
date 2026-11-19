import { z } from 'zod';
import { KINDS, KIND_LIST_NOTED, REF_TYPES, SOURCES, STATUSES } from './types';

export const EntrySchema = z.object({
  id: z.string().describe('Unique id of the entry. The last 8 characters work as a short id.'),
  createdAt: z.string().describe('When the entry was created, as an ISO timestamp.'),
  updatedAt: z.string().describe('When the entry last changed, as an ISO timestamp.'),
  deletedAt: z.string().nullable().describe('When the entry was deleted, or null if it is not deleted.'),
  deviceId: z.string().describe('Id of the device that created the entry.'),
  summary: z.string().describe('One line that says what happened.'),
  details: z.string().nullable().describe('Longer text for the entry, or null.'),
  kind: z.enum(KINDS).describe(`${KIND_LIST_NOTED}.`),
  status: z.enum(STATUSES).nullable().describe('open or resolved for a blocker or next entry. Null for a done entry.'),
  resolvedAt: z.string().nullable().describe('When the entry was resolved, or null.'),
  resolvedByEntryId: z.string().nullable().describe('Id of the entry that resolved this one, or null.'),
  project: z.string().describe('Project name.'),
  repo: z.string().nullable().describe('Repository (owner/name), or null.'),
  branch: z.string().nullable().describe('Git branch, or null.'),
  source: z.enum(SOURCES).describe('Where the entry came from: the CLI, the MCP server, or a migration.'),
  agent: z.string().nullable().describe('Name of the agent that logged the entry, or null.'),
  tags: z.array(z.string()).describe('Tags of the entry.'),
  refs: z.array(z.object({
    type: z.enum(REF_TYPES).describe('Kind of reference.'),
    value: z.string().describe('The PR number, ticket key, commit hash, or URL.'),
    repo: z.string().optional().describe('Repository (owner/name) of the reference.'),
  })).describe('References such as PRs and ticket keys.'),
});
export type EntryJson = z.infer<typeof EntrySchema>;
