import { endOfDay, parse, startOfDay } from 'date-fns';
import type { Kind, Source, Status } from './types';

export interface Query {
  project?: string;
  repo?: string;
  tags?: string[];
  text?: string;
  kind?: Kind[];
  status?: Status;
  source?: Source;
  from?: string; // date-only (local day) or ISO timestamp
  to?: string;
  limit?: number;
  order?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

export interface ResolvedQuery {
  projects?: string[]; // target first, then alias keys that map to it
  repo?: string;
  tags?: string[];
  terms?: string[];
  kind?: Kind[];
  status?: Status;
  source?: Source;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  order: 'asc' | 'desc';
  includeDeleted: boolean;
}

export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

// C0 control characters (U+0000 to U+001F). SQLite LIKE stops at NUL and FTS5 fails on it.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/g;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/** Strip control characters from each term and drop terms with no letter or digit. */
export function cleanSearchTerms(terms: string[]): string[] {
  return terms
    .map((t) => t.replace(CONTROL_CHARS, ''))
    .filter((t) => HAS_WORD_CHAR.test(t));
}

/** Split text on whitespace, then clean the terms. */
function searchTerms(text: string): string[] {
  return cleanSearchTerms(text.split(/\s+/).filter(Boolean));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseBound(value: string, side: 'from' | 'to'): number {
  let date: Date;
  if (DATE_ONLY.test(value)) {
    const day = parse(value, 'yyyy-MM-dd', new Date());
    date = side === 'from' ? startOfDay(day) : endOfDay(day);
  } else {
    date = new Date(value);
  }
  const ms = date.getTime();
  if (isNaN(ms)) throw new InvalidQueryError(`Invalid date: ${value}`);
  return ms;
}

export function resolveProjectAlias(name: string, aliases: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(aliases, name)) return aliases[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(aliases)) {
    if (key.toLowerCase() === lower) return aliases[key];
  }
  return name;
}

export function resolveQuery(q: Query, aliases: Record<string, string>): ResolvedQuery {
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit <= 0)) {
    throw new InvalidQueryError('limit must be a positive integer');
  }
  let projects: string[] | undefined;
  if (q.project) {
    const target = resolveProjectAlias(q.project, aliases);
    const targetLower = target.toLowerCase();
    projects = [target];
    for (const [key, value] of Object.entries(aliases)) {
      if (value.toLowerCase() === targetLower && key !== target && !projects.includes(key)) projects.push(key);
    }
  }
  // undefined: no text filter. An empty array: text was given but no usable term is left, so nothing matches.
  const terms = q.text !== undefined ? searchTerms(q.text) : undefined;
  return {
    projects,
    repo: q.repo,
    tags: q.tags && q.tags.length > 0 ? q.tags : undefined,
    terms,
    kind: q.kind && q.kind.length > 0 ? q.kind : undefined,
    status: q.status,
    source: q.source,
    fromMs: q.from ? parseBound(q.from, 'from') : undefined,
    toMs: q.to ? parseBound(q.to, 'to') : undefined,
    limit: q.limit,
    order: q.order ?? 'asc',
    includeDeleted: q.includeDeleted ?? false,
  };
}
