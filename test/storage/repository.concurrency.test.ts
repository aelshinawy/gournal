import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { openDb } from '../../src/storage/db';
import { hasFts5 } from '../fts5';
import { rmTmp } from '../helpers/tmp';

const fixture = path.join(__dirname, '..', 'fixtures', 'repo-writer.ts');

function runWriter(home: string, id: number, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', fixture, home, String(id), String(count)],
      { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, GOURNAL_HOME: home } }
    );
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${id} exited with ${code}: ${stderr}`))));
  });
}

describe('concurrent repository writers', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-conc-')); });
  afterEach(() => rmTmp(home));

  test('no entry is lost under 8 concurrent writers', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, id) => runWriter(home, id, 25)));
    const db = openDb(path.join(home, 'gournal.db'));
    try {
      const rows = db.prepare('SELECT summary FROM entries').all() as { summary: string }[];
      expect(rows).toHaveLength(200);
      expect(new Set(rows.map((r) => r.summary)).size).toBe(200);
      if (hasFts5) expect(db.prepare('SELECT count(*) c FROM entries_fts WHERE entries_fts MATCH ?').get('entry')).toEqual({ c: 200 });
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    } finally {
      db.close();
    }
  }, 60_000);
});
