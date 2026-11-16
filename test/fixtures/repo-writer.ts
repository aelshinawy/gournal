import path from 'path';
import { openDb } from '../../src/storage/db';
import { loadConfig } from '../../src/storage/config';
import { createRepository } from '../../src/storage/sqlite-repository';

const [home, id, count] = process.argv.slice(2);
const dbPath = path.join(home, 'gournal.db');
// Use a long busy timeout. The test checks lock correctness, not the speed of the disk.
const db = openDb(dbPath, { busyTimeoutMs: 120_000 });
const repo = createRepository(db, loadConfig(home), dbPath);
for (let i = 0; i < Number(count); i++) {
  repo.add({ summary: `writer-${id}-entry-${i}`, project: 'concurrency', source: 'cli' });
}
db.close();
