import type { Activity, ActivityType, NewActivityInput } from './activity';

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
