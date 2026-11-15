import type { Entry } from './core';
import type { LegacyEntry } from './storage/legacy-json';

/** Map a v2 entry to the legacy shape that the report, log, export, and stats renderers read. */
export function toLegacy(e: Entry, opts: { withDetails?: boolean } = {}): LegacyEntry {
  const message = opts.withDetails && e.details ? `${e.summary}\n\n${e.details}` : e.summary;
  return { timestamp: e.createdAt, message, project: e.project, tags: e.tags };
}
