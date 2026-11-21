import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import type { ActivityRepository, EntryRepository } from '../core';
import type { Config } from '../core';
import { createActivityRepository } from './activity-repository';
import { backupDbIfNeeded } from './backup';
import { loadConfig } from './config';
import { openDb } from './db';
import { gournalHome } from './home';
import { createWriter } from './writer';
import { createRepository } from './sqlite-repository';

export interface Journal {
  repo: EntryRepository;
  activity: ActivityRepository;
  db: DatabaseSync;
  config: Config;
  /** Take today's backup if none exists yet. Throws when the backup fails. */
  backupIfNeeded(): void;
  close(): void;
}

/** Open the journal in the given home folder. */
export function openJournal(home: string = gournalHome()): Journal {
  const config = loadConfig(home);
  const dbPath = path.join(home, 'gournal.db');
  const db = openDb(dbPath);
  try {
    const writer = createWriter(db, dbPath);
    const repo = createRepository(db, config, dbPath, writer);
    const activity = createActivityRepository(db, config, dbPath, writer);
    return { repo, activity, db, config, backupIfNeeded: () => { backupDbIfNeeded(db, dbPath); }, close: () => db.close() };
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    throw err;
  }
}
