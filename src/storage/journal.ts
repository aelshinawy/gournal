import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import type { ActivityRepository, EntryRepository } from '../core';
import type { Config } from '../core';
import { createActivityRepository } from './activity-repository';
import { loadConfig } from './config';
import { openDb } from './db';
import { gournalHome } from './home';
import { createWriter } from './writer';
import { importLegacy } from './migrate';
import { createRepository } from './sqlite-repository';

export interface Journal {
  repo: EntryRepository;
  activity: ActivityRepository;
  db: DatabaseSync;
  config: Config;
  close(): void;
}

/**
 * Open the journal. If entries.json exists, import it on every open. That covers the first
 * migration and the late writes of old v0.5 and v0.6 processes.
 * With legacyImport false, the caller imports it later (gournal import runs the bundle first).
 */
export function openJournal(home: string = gournalHome(), opts: { legacyImport?: boolean } = {}): Journal {
  const config = loadConfig(home);
  const dbPath = path.join(home, 'gournal.db');
  const db = openDb(dbPath);
  try {
    const writer = createWriter(db, dbPath);
    const repo = createRepository(db, config, dbPath, writer);
    const activity = createActivityRepository(db, config, dbPath, writer);
    const jsonPath = path.join(home, 'entries.json');
    if ((opts.legacyImport ?? true) && fs.existsSync(jsonPath)) {
      try {
        importLegacy(db, repo, config, jsonPath);
      } catch (err) {
        // The legacy import never blocks the journal. The next open retries it.
        process.stderr.write(`gournal: legacy import failed; will retry (${(err as Error).message})\n`);
      }
    }
    return { repo, activity, db, config, close: () => db.close() };
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    throw err;
  }
}
