import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { makeTmp, rmTmp } from '../helpers/tmp';

const fixture = path.join(__dirname, '..', 'fixtures', 'repo-opener.ts');

function runOpener(home: string, startAt: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', fixture, home, String(startAt)],
      { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, GOURNAL_HOME: home } }
    );
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`opener exited with ${code}: ${stderr}`))));
  });
}

describe('openDb first-open race', () => {
  let home: string;
  beforeEach(() => { home = makeTmp('gournal-race-'); });
  afterEach(() => rmTmp(home));

  test('6 processes that open a new database at the same time all succeed', async () => {
    const startAt = Date.now() + 3000;
    await Promise.all(Array.from({ length: 6 }, () => runOpener(home, startAt)));
    const db = openDb(path.join(home, 'gournal.db'));
    try {
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    } finally {
      db.close();
    }
  }, 60_000);

  test('openDb retries when another connection holds the file during the switch to WAL', () => {
    const file = path.join(home, 'gournal.db');
    // The first connection is in rollback mode and holds a read lock. The switch to WAL needs an exclusive lock.
    const holder = new DatabaseSync(file);
    holder.exec('CREATE TABLE t (a)');
    holder.exec('BEGIN');
    holder.prepare('SELECT * FROM t').all();
    const sleeps: number[] = [];
    const db = openDb(file, {
      busyTimeoutMs: 1,
      sleep: (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) holder.exec('COMMIT');
      },
    });
    try {
      expect(sleeps.length).toBeGreaterThanOrEqual(2);
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    } finally {
      db.close();
      holder.close();
    }
  });

  test('openDb gives up with the busy error after the retry budget', () => {
    const file = path.join(home, 'gournal.db');
    const holder = new DatabaseSync(file);
    holder.exec('CREATE TABLE t (a)');
    holder.exec('BEGIN');
    holder.prepare('SELECT * FROM t').all();
    // A fake clock: each sleep moves the time forward. The budget ends after a bounded number of sleeps.
    let clock = 0;
    let sleeps = 0;
    try {
      expect(() => openDb(file, {
        busyTimeoutMs: 1,
        now: () => clock,
        sleep: (ms) => { sleeps++; clock += ms; },
      })).toThrow(/database is locked/);
      expect(sleeps).toBeGreaterThan(0);
      expect(sleeps).toBeLessThan(100);
    } finally {
      holder.exec('COMMIT');
      holder.close();
    }
  });

  test('openDb does not retry an error that is not SQLITE_BUSY', () => {
    const file = path.join(home, 'gournal.db');
    fs.writeFileSync(file, 'this is not a database, this is not a database, this is not a database');
    let sleeps = 0;
    expect(() => openDb(file, { sleep: () => { sleeps++; } })).toThrow(/not valid/);
    expect(sleeps).toBe(0);
  });
});
