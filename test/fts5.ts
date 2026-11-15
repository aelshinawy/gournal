import { DatabaseSync } from 'node:sqlite';
import { hasFts5 as detect } from '../src/storage/schema';

// True when this node:sqlite build has FTS5 and the run does not simulate a build without it.
// Official Linux Node builds have no FTS5. GOURNAL_DISABLE_FTS5=1 npx jest simulates that here.
export const hasFts5: boolean = (() => {
  const db = new DatabaseSync(':memory:');
  try { return detect(db); } finally { db.close(); }
})();

// Use for tests that read entries_fts or run MATCH.
export const ftsTest = hasFts5 ? test : test.skip;
