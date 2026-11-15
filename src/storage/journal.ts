import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import type { EntryRepository } from '../core/repository';
import { loadConfig, type Config } from './config';
import { openDb } from './db';
import { gournalHome } from './home';
import { importLegacy } from './migrate';
import { createRepository } from './sqlite-repository';

export interface Journal {
  repo: EntryRepository;
  db: DatabaseSync;
  config: Config;
  close(): void;
}

/**
 * Open the journal. If entries.json exists, import it on every open. That covers the first
 * migration and the late writes of old v0.5 and v0.6 processes.
 */
export function openJournal(home: string = gournalHome()): Journal {
  const config = loadConfig(home);
  const dbPath = path.join(home, 'gournal.db');
  const db = openDb(dbPath);
  try {
    const repo = createRepository(db, config, dbPath);
    const jsonPath = path.join(home, 'entries.json');
    if (fs.existsSync(jsonPath)) {
      try {
        importLegacy(db, repo, config, jsonPath);
      } catch (err) {
        // The legacy import never blocks the journal. The next open retries it.
        process.stderr.write(`gournal: legacy import failed; will retry (${(err as Error).message})\n`);
      }
    }
    return { repo, db, config, close: () => db.close() };
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    throw err;
  }
}
