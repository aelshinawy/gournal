import path from 'path';
import { openDb } from '../../src/storage/db';

// Wait until the shared start time, then open the database. All processes start the open together.
const [home, startAt] = process.argv.slice(2);
while (Date.now() < Number(startAt)) { /* spin */ }
openDb(path.join(home, 'gournal.db')).close();
