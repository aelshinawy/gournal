import type { Entry, EntryPatch, NewEntryInput } from './types';

export interface ListQuery {
  project?: string;
  tags?: string[];
  from?: string;
  to?: string;
  limit?: number;
  includeDeleted?: boolean;
}

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
  /** Oldest first. Non-deleted unless includeDeleted. */
  list(q?: ListQuery): Entry[];
  allTags(): string[];
  getState(key: string): string | null;
  setState(key: string, value: string): void;
}
