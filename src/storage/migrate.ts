import crypto from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import { extractRefs, mergeRefs, normalizeTags, splitSummary } from '../core';
import type { NewEntryInput } from '../core';
import type { EntryRepository } from '../core/repository';
import type { Config } from './config';
import { CorruptJournalError, readLegacyEntriesSync } from './legacy-json';
import type { LegacyEntry } from './legacy-json';

const NO_MESSAGE = '(no message)';
const NO_PROJECT = 'uncategorized';

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

/** Fill defaults for a malformed item. The timestamp and message stay exactly as written when they are strings. */
function sanitize(raw: unknown): LegacyEntry {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    timestamp: typeof o.timestamp === 'string' ? o.timestamp : '',
    message: typeof o.message === 'string' ? o.message : '',
    project: typeof o.project === 'string' ? o.project : NO_PROJECT,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : [],
  };
}

/** Identity of each legacy item: (timestamp, sha256(message), occurrence among identical pairs in file order). */
export function legacyKey(entries: LegacyEntry[]): { index: number; timestamp: string; messageHash: string; occurrence: number }[] {
  const seen = new Map<string, number>();
  return entries.map((e, index) => {
    const messageHash = sha256(e.message);
    const pair = `${e.timestamp}\u0000${messageHash}`;
    const occurrence = seen.get(pair) ?? 0;
    seen.set(pair, occurrence + 1);
    return { index, timestamp: e.timestamp, messageHash, occurrence };
  });
}

/** Mechanical conversion of one legacy item (spec 9.4.2). `index` is only used in the warning text. */
export function mechanicalEntry(e: LegacyEntry, config: Config, index = 0): NewEntryInput {
  const opts = { ticketPrefixes: config.ticketPrefixes };
  const blank = e.message.trim().length === 0;
  const { summary, details } = blank ? { summary: NO_MESSAGE, details: null } : splitSummary(e.message);
  const { tags, refs: tagRefs } = normalizeTags(e.tags, config.tagAliases, opts);
  const ms = Date.parse(e.timestamp);
  let createdAt: string;
  if (Number.isNaN(ms)) {
    process.stderr.write(`gournal: legacy entry ${index} has an invalid timestamp; using import time\n`);
    createdAt = new Date().toISOString();
  } else {
    createdAt = new Date(ms).toISOString();
  }
  return {
    summary,
    details,
    kind: 'done',
    source: 'migration',
    project: e.project,
    tags,
    refs: mergeRefs(tagRefs, blank ? [] : extractRefs(e.message, opts)),
    createdAt,
  };
}

/**
 * Import every legacy item that legacy_map does not know yet. Never writes entries.json.
 * The check and all inserts run in one transaction, so a failure leaves nothing behind.
 */
export function importLegacy(
  db: DatabaseSync,
  repo: EntryRepository,
  config: Config,
  jsonPath: string
): { imported: number; alreadyPresent: number } {
  let items: LegacyEntry[];
  try {
    items = readLegacyEntriesSync(jsonPath).map(sanitize);
  } catch (err) {
    const reason = err instanceof CorruptJournalError ? err.message : (err as Error).message;
    process.stderr.write(`gournal: entries.json is not valid; legacy import skipped (${reason})\n`);
    return { imported: 0, alreadyPresent: 0 };
  }
  if (items.length === 0) return { imported: 0, alreadyPresent: 0 };
  const keys = legacyKey(items);

  const result = repo.transaction(() => {
    const known = new Set(
      (db.prepare('SELECT timestamp, message_hash, occurrence FROM legacy_map').all() as
        { timestamp: string; message_hash: string; occurrence: number }[])
        .map((r) => `${r.timestamp}\u0000${r.message_hash}\u0000${r.occurrence}`)
    );
    const insert = db.prepare(
      'INSERT INTO legacy_map (legacy_index, timestamp, message_hash, occurrence, entry_id) VALUES (?, ?, ?, ?, ?)'
    );
    let imported = 0;
    let alreadyPresent = 0;
    for (const k of keys) {
      if (known.has(`${k.timestamp}\u0000${k.messageHash}\u0000${k.occurrence}`)) { alreadyPresent++; continue; }
      const entry = repo.add(mechanicalEntry(items[k.index], config, k.index));
      insert.run(k.index, k.timestamp, k.messageHash, k.occurrence, entry.id);
      imported++;
    }
    return { imported, alreadyPresent };
  });
  if (result.imported > 0) process.stderr.write(`gournal: imported ${result.imported} entries from entries.json\n`);
  return result;
}
