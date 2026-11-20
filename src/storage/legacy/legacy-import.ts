import crypto from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PROJECT, extractRefs, mergeRefs, normalizeTags, splitSummary } from '../../core';
import type { NewEntryInput } from '../../core';
import type { EntryRepository } from '../../core';
import { createActivityRepository } from '../activity-repository';
import { createWriter } from '../writer';
import type { Config } from '../../core';
import { CorruptJournalError, readLegacyEntriesSync } from './legacy-json';
import type { LegacyEntry } from './legacy-json';

const NO_MESSAGE = '(no message)';

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

/** A legacy item whose message was not a string. Its JSON text is kept in `message`. */
type Sanitized = LegacyEntry & { nonStringMessage?: true };

const MAX_MS = 2 ** 48 - 1;

/** Fill defaults for a malformed item. Strings stay exactly as written. Nothing is dropped. */
export function sanitize(raw: unknown): Sanitized {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const m = o.message;
  const base = {
    timestamp: typeof o.timestamp === 'string' ? o.timestamp : '',
    project: typeof o.project === 'string' ? o.project : DEFAULT_PROJECT,
    tags: Array.isArray(o.tags) ? o.tags.map((t) => (typeof t === 'string' ? t : String(t))) : [],
  };
  if (typeof m === 'string') return { ...base, message: m };
  if (m === undefined || m === null) return { ...base, message: '' };
  return { ...base, message: JSON.stringify(m) ?? String(m), nonStringMessage: true };
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
export function mechanicalEntry(e: Sanitized, config: Config, index = 0): NewEntryInput {
  const opts = { ticketPrefixes: config.ticketPrefixes };
  const blank = e.message.trim().length === 0;
  const { summary, details } = e.nonStringMessage
    ? { summary: NO_MESSAGE, details: e.message }
    : blank ? { summary: NO_MESSAGE, details: null } : splitSummary(e.message);
  const { tags, refs: tagRefs } = normalizeTags(e.tags, config.tagAliases, opts);
  const ms = Date.parse(e.timestamp);
  let createdAt: string;
  if (Number.isNaN(ms) || ms < 0 || ms > MAX_MS) {
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
    refs: mergeRefs(tagRefs, blank || e.nonStringMessage ? [] : extractRefs(e.message, opts)),
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
  let items: Sanitized[];
  try {
    items = readLegacyEntriesSync(jsonPath).map(sanitize);
  } catch (err) {
    process.stderr.write(err instanceof CorruptJournalError
      ? `gournal: entries.json is not valid; legacy import skipped (${err.message})\n`
      : `gournal: entries.json could not be read; legacy import skipped (${(err as Error).message})\n`);
    return { imported: 0, alreadyPresent: 0 };
  }
  if (items.length === 0) return { imported: 0, alreadyPresent: 0 };
  const keys = legacyKey(items);
  const mapKey = (t: string, h: string, o: number) => `${t}\u0000${h}\u0000${o}`;
  const loadKnown = () => new Set(
    (db.prepare('SELECT timestamp, message_hash, occurrence FROM legacy_map').all() as
      { timestamp: string; message_hash: string; occurrence: number }[])
      .map((r) => mapKey(r.timestamp, r.message_hash, r.occurrence))
  );

  // Fast path: nothing new means no write lock and no backup.
  const first = loadKnown();
  if (keys.every((k) => first.has(mapKey(k.timestamp, k.messageHash, k.occurrence)))) {
    return { imported: 0, alreadyPresent: keys.length };
  }

  const result = repo.transaction(() => {
    // Check again inside the lock: another process may have imported meanwhile.
    const known = loadKnown();
    const insert = db.prepare(
      'INSERT INTO legacy_map (legacy_index, timestamp, message_hash, occurrence, entry_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    let imported = 0;
    let alreadyPresent = 0;
    const ids: string[] = [];
    for (const k of keys) {
      if (known.has(mapKey(k.timestamp, k.messageHash, k.occurrence))) { alreadyPresent++; continue; }
      const entry = repo.add(mechanicalEntry(items[k.index], config, k.index));
      insert.run(k.index, k.timestamp, k.messageHash, k.occurrence, entry.id, Date.parse(entry.updatedAt));
      imported++;
      ids.push(entry.id);
    }
    return { imported, alreadyPresent, ids };
  });
  if (result.imported > 0) process.stderr.write(`gournal: imported ${result.imported} entries from entries.json\n`);
  // Links are derived data. A relink failure never fails the import.
  if (result.ids.length > 0) {
    try {
      createActivityRepository(db, config, null, createWriter(db, null)).relinkEntries(result.ids);
    } catch (err) {
      process.stderr.write(`gournal: relink after import failed (${(err as Error).message})\n`);
    }
  }
  return { imported: result.imported, alreadyPresent: result.alreadyPresent };
}
