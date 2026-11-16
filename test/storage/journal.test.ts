import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../../src/storage/journal';
import { rmTmp } from '../helpers/tmp';

let home: string;
let stderr: jest.SpyInstance;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-journal-'));
  stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => { stderr.mockRestore(); rmTmp(home); });

const jsonPath = () => path.join(home, 'entries.json');
const legacy = (n: number) => Array.from({ length: n }, (_, i) => ({
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), message: `entry ${i}`, project: 'p', tags: ['t'],
}));
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(jsonPath())).digest('hex');

test('opens with no entries.json', () => {
  const j = openJournal(home);
  try {
    expect(j.repo.find()).toEqual([]);
    expect(j.config.deviceId).toBeTruthy();
    expect(fs.existsSync(path.join(home, 'gournal.db'))).toBe(true);
  } finally { j.close(); }
});

test('imports entries.json on first open and late writes on the next open', () => {
  fs.writeFileSync(jsonPath(), JSON.stringify(legacy(3)));
  let j = openJournal(home);
  try { expect(j.repo.find()).toHaveLength(3); } finally { j.close(); }
  fs.writeFileSync(jsonPath(), JSON.stringify(legacy(5)));
  j = openJournal(home);
  try { expect(j.repo.find()).toHaveLength(5); } finally { j.close(); }
});

test('uses GOURNAL_HOME when no home is passed', () => {
  const prev = process.env.GOURNAL_HOME;
  process.env.GOURNAL_HOME = home;
  try {
    fs.writeFileSync(jsonPath(), JSON.stringify(legacy(2)));
    const j = openJournal();
    try { expect(j.repo.find()).toHaveLength(2); } finally { j.close(); }
  } finally {
    if (prev === undefined) delete process.env.GOURNAL_HOME; else process.env.GOURNAL_HOME = prev;
  }
});

test('entries.json is never modified by openJournal', () => {
  fs.writeFileSync(jsonPath(), JSON.stringify(legacy(4), null, 2));
  const h = sha();
  openJournal(home).close();
  openJournal(home).close();
  expect(sha()).toBe(h);
  fs.writeFileSync(jsonPath(), '[{"x"');
  const corrupt = sha();
  const j = openJournal(home);
  try {
    expect(j.repo.find()).toHaveLength(4);
    expect(j.repo.add({ summary: 's', project: 'p', source: 'cli' }).id).toBeTruthy();
  } finally { j.close(); }
  expect(sha()).toBe(corrupt);
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

test('concurrent first start imports once', async () => {
  fs.writeFileSync(jsonPath(), JSON.stringify(legacy(50)));
  await Promise.all(Array.from({ length: 6 }, () => runOpener()));
  const j = openJournal(home);
  try {
    expect(j.repo.find()).toHaveLength(50);
    expect((j.db.prepare('SELECT count(*) c FROM legacy_map').get() as { c: number }).c).toBe(50);
  } finally { j.close(); }
  const raw = new DatabaseSync(path.join(home, 'gournal.db'));
  try { expect(raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' }); } finally { raw.close(); }
}, 60_000);

test('a failing legacy import never blocks the journal and is retried on the next open', () => {
  fs.writeFileSync(jsonPath(), JSON.stringify(legacy(3)));
  // Open once without entries.json so the schema exists, then add the trigger.
  fs.renameSync(jsonPath(), jsonPath() + '.hold');
  openJournal(home).close();
  fs.renameSync(jsonPath() + '.hold', jsonPath());
  const trig = new DatabaseSync(path.join(home, 'gournal.db'));
  trig.exec("CREATE TRIGGER fail_map BEFORE INSERT ON legacy_map BEGIN SELECT RAISE(ABORT, 'injected'); END");
  trig.close();
  let j = openJournal(home);
  try {
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('gournal: legacy import failed; will retry (');
    expect(j.repo.find()).toHaveLength(0);
    expect(j.repo.add({ summary: 'still works', project: 'p', source: 'cli' }).id).toBeTruthy();
  } finally { j.close(); }
  const fix = new DatabaseSync(path.join(home, 'gournal.db'));
  fix.exec('DROP TRIGGER fail_map');
  fix.close();
  j = openJournal(home);
  try { expect(j.repo.find()).toHaveLength(4); } finally { j.close(); }
});

test('legacyImport false opens without importing entries.json', () => {
  fs.writeFileSync(jsonPath(), JSON.stringify(legacy(3)));
  const j = openJournal(home, { legacyImport: false });
  try { expect(j.repo.find()).toEqual([]); } finally { j.close(); }
});
