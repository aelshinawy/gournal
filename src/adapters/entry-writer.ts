// The Entry writer: the single place for every adapter-level entry change (add, update, resolve, delete, restore, undo, clear).
// Bulk import and migration write through storage.
// An adapter (CLI or MCP) parses its input, resolves the identity, and calls this module.
// The summary rule, the resolves policy, the similar-tag check, and the relink live here.
// The repository keeps `cleanSummary` as an invariant guard, so a bad summary never reaches the database.
// The module returns Write notes (facts about a write that did not stop it). write-note-text.ts holds the wording that the adapters share.
import { canResolve, checkSummary, closeTags, noEntryMessage, normalizeTags, NOT_RESOLVABLE } from '../core';
import type { Entry, EntryPatch, Kind, NewEntryInput, Ref, RepoIdentity, Source } from '../core';
import type { Journal } from '../storage';
import { relinkAfterWrite } from './sync';

export const RETRY_WINDOW_MS = 10 * 60 * 1000;
export const RETRY_PREFIX = 60;

/** A Write note: a fact about a write that did not stop it. Each adapter words it. */
export type WriteNote =
  | { type: 'split' }
  | { type: 'resolveDropped'; id: string; reason: string }
  | { type: 'similarTag'; tag: string; close: string[] };

export interface WriteResult { entry: Entry; notes: WriteNote[] }

export interface AddInput {
  summary: string;               // raw, untrimmed
  details?: string;
  kind?: Kind;
  identity: RepoIdentity;        // already resolved by the adapter
  source: Exclude<Source, 'migration'>;
  agent?: string;
  tags?: string[];
  refs?: Ref[];
  resolves?: string[];
}

export interface UpdateInput {
  summary?: string; details?: string; kind?: Kind; project?: string; tags?: string[]; refs?: Ref[];
}

export interface EntryWriterOptions {
  /** Applies to add and update. On: a too-long summary without details is rejected once, and a retry within RETRY_WINDOW_MS is split. Off: it is always split. */
  retryMemory: boolean;
  /** Epoch milliseconds. Feeds the retry memory only. */
  clock: () => number;
}

export interface EntryWriter {
  add(input: AddInput): WriteResult;
  update(id: string, input: UpdateInput): WriteResult;
  resolve(id: string, by?: string): Entry;
  delete(id: string): Entry;      // soft delete
  restore(id: string): Entry;
  undo(): Entry | null;           // latest live entry of this device, soft-deleted
  clear(): number;                // softDeleteAll
}

export function createEntryWriter(
  journal: Pick<Journal, 'repo' | 'activity' | 'config'>,
  opts: EntryWriterOptions,
): EntryWriter {
  const { repo, config } = journal;

  // Rejected summary to the time of rejection. Lives as long as the writer.
  const rejected = new Map<string, number>();
  const isRetry = (summary: string, now: number): boolean => {
    for (const [text, at] of rejected) if (now - at > RETRY_WINDOW_MS) rejected.delete(text);
    const head = (s: string) => Array.from(s).slice(0, RETRY_PREFIX).join('');
    for (const text of rejected.keys()) {
      if (summary === text || summary.startsWith(head(text))) return true;
    }
    return false;
  };

  const similarTagNotes = (tags: string[] | undefined): WriteNote[] => {
    const notes: WriteNote[] = [];
    if (!tags?.length) return notes;
    const known = new Set(repo.allTags());
    const normalized = normalizeTags(tags, config.tagAliases, { ticketPrefixes: config.ticketPrefixes }).tags;
    for (const tag of normalized) {
      if (known.has(tag)) continue;
      const close = closeTags(tag, [...known]);
      if (close.length > 0) notes.push({ type: 'similarTag', tag, close });
    }
    return notes;
  };

  // The summary rule that add and update share. A rejected summary is remembered when retry memory is on.
  const applySummaryRule = (
    summary: string,
    details: string | undefined,
  ): { summary: string; details: string | null; split: boolean } => {
    const now = opts.clock();
    const text = summary.trim();
    const retry = opts.retryMemory && isRetry(text, now);
    const allowSplit = !opts.retryMemory || details !== undefined || retry;
    const check = checkSummary(summary, details, { allowSplit });
    if (!check.ok) {
      if (opts.retryMemory) rejected.set(text, now);
      throw new Error(check.error);
    }
    return { summary: check.summary, details: check.details, split: check.summary !== text };
  };

  const add = (input: AddInput): WriteResult => {
    const check = applySummaryRule(input.summary, input.details);
    const similar = similarTagNotes(input.tags);
    const base: NewEntryInput = {
      summary: check.summary,
      details: check.details,
      kind: input.kind,
      project: input.identity.project,
      repo: input.identity.repo ?? undefined,
      branch: input.identity.branch ?? undefined,
      source: input.source,
      agent: input.agent,
      tags: input.tags,
      refs: input.refs,
    };
    const dropped: WriteNote[] = [];
    // A bad resolves id never stops the entry. The check and the add share one transaction.
    const entry = repo.transaction(() => {
      const valid = new Set<string>();
      for (const id of input.resolves ?? []) {
        try {
          const target = repo.get(id);
          if (!target) {
            dropped.push({ type: 'resolveDropped', id, reason: noEntryMessage(id) });
          } else if (!canResolve(target.kind, target.status)) {
            dropped.push({ type: 'resolveDropped', id, reason: NOT_RESOLVABLE });
          } else {
            valid.add(target.id);
          }
        } catch (err) {
          dropped.push({ type: 'resolveDropped', id, reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return repo.add({ ...base, resolves: [...valid] });
    });
    relinkAfterWrite(journal, [entry.id]);
    const notes: WriteNote[] = [...similar, ...dropped];
    if (check.split) notes.push({ type: 'split' });
    return { entry, notes };
  };

  const update = (id: string, input: UpdateInput): WriteResult => {
    const patch: EntryPatch = {};
    let split = false;
    if (input.summary !== undefined) {
      const check = applySummaryRule(input.summary, input.details);
      patch.summary = check.summary;
      if (check.details !== null) patch.details = check.details;
      split = check.split;
    } else if (input.details !== undefined) {
      patch.details = input.details;
    }
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.project !== undefined) patch.project = input.project;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.refs !== undefined) patch.refs = input.refs;
    const entry = repo.update(id, patch);
    relinkAfterWrite(journal, [entry.id]);
    return { entry, notes: split ? [{ type: 'split' }] : [] };
  };

  return {
    add,
    update,
    resolve: (id, by) => repo.resolve(id, by),
    delete: (id) => repo.softDelete(id),
    restore: (id) => repo.restore(id),
    undo: () => {
      const latest = repo.latestForDevice();
      return latest ? repo.softDelete(latest.id) : null;
    },
    clear: () => repo.softDeleteAll(),
  };
}
