import type { Query } from './query';
import type { Activity, ActivityType, NewActivityInput } from './activity';
import type { Entry, EntryPatch, NewEntryInput } from './types';

export interface EntryRepository {
  /**
   * Run fn in one transaction. All writes inside commit together or not at all.
   * A write inside fn joins the open transaction without a savepoint.
   * After a failed write, the caller must not catch the error and continue inside fn.
   */
  transaction<T>(fn: () => T): T;
  add(input: NewEntryInput): Entry;
  /** Full id or unique suffix of 6 or more chars. Throws AmbiguousIdError on more than one match. */
  get(idOrSuffix: string): Entry | null;
  update(id: string, patch: EntryPatch): Entry;
  softDelete(id: string): Entry;
  restore(id: string): Entry;
  /** Only an open blocker or next. Otherwise throws. */
  resolve(id: string, byEntryId?: string): Entry;
  softDeleteAll(): number;
  /** Newest non-deleted entry with this deviceId. */
  latestForDevice(): Entry | null;
  /** Entries that match the query. Oldest first unless order is desc. Non-deleted unless includeDeleted. */
  find(q?: Query): Entry[];
  /** Tag counts over the entries that match the query (no limit). Count desc, then tag asc. */
  tagCounts(q?: Query): { tag: string; count: number }[];
  /** Project counts over the entries that match the query (no limit). Count desc, then project asc. */
  projectCounts(q?: Query): { project: string; count: number }[];
  /** 'fts' when text search uses the FTS5 index, 'like' when it falls back to substring match. */
  searchMode(): 'fts' | 'like';
  allTags(): string[];
  getState(key: string): string | null;
  setState(key: string, value: string): void;
}

export interface ActivityQuery {
  from?: string;
  to?: string;
  repo?: string;
  types?: ActivityType[];
  /** false: only activity with no live link. */
  linked?: boolean;
}

export interface ActivityRepository {
  upsert(items: NewActivityInput[]): { inserted: number; updated: number; ids: string[] };
  /** Oldest first by occurredAt. */
  find(q?: ActivityQuery): Activity[];
  /** Live links only, oldest first. */
  linkedTo(entryIds: string[]): Record<string, Activity[]>;
  /** Returns the number of links added. */
  relinkEntries(entryIds: string[]): number;
  /** Returns the number of links added. */
  relinkActivity(activityIds: string[]): number;
  tryLease(name: string, owner: string, ttlMs: number): boolean;
  releaseLease(name: string, owner: string): void;
}
