import type { Ref } from '../labels/refs';

export const KINDS = ['done', 'blocker', 'next'] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ['open', 'resolved'] as const;
export type Status = (typeof STATUSES)[number];

/** Joins words as "a or b" for two words and "a, b, or c" for three or more. */
function orList(words: readonly string[]): string {
  if (words.length <= 2) return words.join(' or ');
  return `${words.slice(0, -1).join(', ')}, or ${words[words.length - 1]}`;
}

const KIND_NOTES: Record<Kind, string | null> = { done: null, blocker: 'something stops you', next: 'a planned step' };
/** The kinds as "done, blocker, or next". notes adds each note. defaultKind marks one kind "(default)". */
export function kindList(opts: { notes?: boolean; defaultKind?: Kind } = {}): string {
  return orList(KINDS.map((k) => `${k}${opts.defaultKind === k ? ' (default)' : ''}${opts.notes && KIND_NOTES[k] !== null ? ` (${KIND_NOTES[k]})` : ''}`));
}

export function parseKind(value: string): Kind {
  if (!(KINDS as readonly string[]).includes(value)) throw new Error(`Unknown kind "${value}". Use ${kindList()}.`);
  return value as Kind;
}

export function parseStatus(value: string): Status {
  if (!(STATUSES as readonly string[]).includes(value)) throw new Error(`Unknown status "${value}". Use ${orList(STATUSES)}.`);
  return value as Status;
}

export const NOT_RESOLVABLE = 'only an open blocker or next can be resolved';
export const noEntryMessage = (id: string): string => `No entry with id "${id}"`;
/** True for the kinds that start open: blocker and next. */
export function isActionable(kind: string | null): boolean {
  return kind === 'blocker' || kind === 'next';
}
/** True only for an open blocker or next. */
export function canResolve(kind: string | null, status: string | null): boolean {
  return isActionable(kind) && status === 'open';
}
export const EXPORT_FORMATS = ['md', 'csv', 'bundle'] as const;
export const SOURCES = ['cli', 'mcp', 'migration'] as const;
export type Source = (typeof SOURCES)[number];

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
