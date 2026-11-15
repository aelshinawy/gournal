export const KINDS = ['done', 'blocker', 'next'] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ['open', 'resolved'] as const;
export type Status = (typeof STATUSES)[number];
export const EXPORT_FORMATS = ['md', 'csv', 'bundle'] as const;
export type RefType = 'pr' | 'jira' | 'commit' | 'url';
export interface Ref { type: RefType; value: string; repo?: string }
export type Source = 'cli' | 'mcp' | 'migration';

export interface Entry {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string;
  summary: string;
  details: string | null;
  kind: Kind;
  status: Status | null;
  resolvedAt: string | null;
  resolvedByEntryId: string | null;
  project: string;
  repo: string | null;
  branch: string | null;
  source: Source;
  agent: string | null;
  tags: string[];
  refs: Ref[];
}

export interface NewEntryInput {
  summary: string;
  details?: string | null;
  kind?: Kind;
  project: string;
  repo?: string | null;
  branch?: string | null;
  source: Source;
  agent?: string | null;
  tags?: string[];
  refs?: Ref[];
  resolves?: string[];
  createdAt?: string;
}

export type EntryPatch = Partial<Pick<Entry, 'summary' | 'details' | 'kind' | 'project' | 'repo' | 'branch' | 'tags' | 'refs'>>;
