import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../../src/storage/journal';
import { makeTmp, rmTmp } from '../helpers/tmp';

let home: string;
beforeEach(() => { home = makeTmp('gournal-journal-'); });
afterEach(() => { rmTmp(home); });

test('opens a fresh home', () => {
  const j = openJournal(home);
  try {
    expect(j.repo.find()).toEqual([]);
    expect(j.config.deviceId).toBeTruthy();
    expect(fs.existsSync(path.join(home, 'gournal.db'))).toBe(true);
  } finally { j.close(); }
});

test('uses GOURNAL_HOME when no home is passed', () => {
  const prev = process.env.GOURNAL_HOME;
  process.env.GOURNAL_HOME = home;
  try {
    openJournal().close();
    expect(fs.existsSync(path.join(home, 'gournal.db'))).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.GOURNAL_HOME; else process.env.GOURNAL_HOME = prev;
  }
});

function runOpener(): Promise<void> {
  const fixture = path.join(__dirname, '..', 'fixtures', 'journal-opener.ts');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', fixture],
      { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, GOURNAL_HOME: home } });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`opener exited with ${code}: ${err}`))));
  });
}

test('concurrent first start leaves a healthy database', async () => {
  await Promise.all(Array.from({ length: 6 }, () => runOpener()));
  const raw = new DatabaseSync(path.join(home, 'gournal.db'));
  try { expect(raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' }); } finally { raw.close(); }
}, 60_000);
