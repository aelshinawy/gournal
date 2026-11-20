import { parseKind, parseStatus, resolveQuery, type Query } from '../../core';

export const splitList = (v?: string): string[] => (v ? v.split(',').map(x => x.trim()).filter(Boolean) : []);

export interface PeriodCliOptions {
  yesterday?: boolean; week?: boolean; month?: boolean;
  from?: string; to?: string; project?: string; repo?: string; tags?: string;
}
export interface FindCliOptions {
  project?: string; tags?: string; kind?: string; status?: string; repo?: string; from?: string; to?: string; limit?: string;
}

/** Build one Query from CLI options. Validate every value here, so a bad option fails before the journal opens. */
export function buildQuery(options: Partial<FindCliOptions>, text?: string): Query {
  const kind = splitList(options.kind).map(parseKind);
  const status = options.status === undefined ? undefined : parseStatus(options.status);
  const query: Query = {
    project: options.project,
    repo: options.repo,
    tags: splitList(options.tags),
    text,
    kind: kind.length > 0 ? kind : undefined,
    status,
    from: options.from,
    to: options.to,
    limit: options.limit === undefined ? undefined : Number(options.limit),
  };
  resolveQuery(query, {}); // throws on a bad date or limit
  return query;
}
