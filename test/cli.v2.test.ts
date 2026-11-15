import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-cli-v2-'));
const runIn = (home: string, args: string[], input = '') =>
  spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/cli.ts', ...args], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, GOURNAL_HOME: home, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    input,
  });
const rows = (home: string, sql = 'SELECT id, summary, details, status, deleted_at FROM entries ORDER BY created_at') => {
  const db = new DatabaseSync(path.join(home, 'gournal.db'));
  try { return db.prepare(sql).all() as Record<string, string | number | null>[]; } finally { db.close(); }
};
const suffix = (stdout: string) => /\(([0-9A-Z]{8})\)/.exec(stdout)![1];

describe('gournal CLI on the SQLite journal', () => {
  let home: string;
  beforeEach(() => { home = mkHome(); });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
  const run = (...args: string[]) => runIn(home, args);

  test('add -k blocker, then resolve', () => {
    const add = run('add', 'Stuck on CI', '-k', 'blocker');
    expect(add.status).toBe(0);
    expect(add.stdout).toMatch(/✓ Entry added! \([0-9A-Z]{8}\)/);
    const id = suffix(add.stdout);
    const res = run('resolve', id);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Stuck on CI');
    expect(rows(home)[0].status).toBe('resolved');
  });

  test('add --resolves closes a blocker, and a bad id is an error', () => {
    const id = suffix(run('add', 'Blocked', '-k', 'blocker').stdout);
    expect(run('add', 'Fixed it', '--resolves', id).status).toBe(0);
    expect(rows(home)[0].status).toBe('resolved');
    const bad = run('add', 'Nope', '--resolves', 'ZZZZZZZZ');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('No entry with id');
    expect(rows(home)).toHaveLength(2);
  });

  test('add rejects an unknown kind', () => {
    const r = run('add', 'x', '-k', 'wat');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown kind "wat". Use done, blocker, or next.');
    expect(fs.existsSync(path.join(home, 'gournal.db')) ? rows(home) : []).toEqual([]);
  });

  test('undo, then restore', () => {
    run('add', 'first');
    run('add', 'second');
    const undo = run('undo');
    expect(undo.status).toBe(0);
    expect(undo.stdout).toMatch(/✓ Removed: second \(restore with gournal restore [0-9A-Z]{8}\)/);
    const id = /restore ([0-9A-Z]{8})\)/.exec(undo.stdout)![1];
    expect(rows(home).filter((r) => r.deleted_at === null).map((r) => r.summary)).toEqual(['first']);
    const restore = run('restore', id);
    expect(restore.status).toBe(0);
    expect(restore.stdout).toContain('second');
    expect(rows(home).filter((r) => r.deleted_at === null).map((r) => r.summary)).toEqual(['first', 'second']);
  });

  test('undo on an empty journal', () => {
    expect(run('undo').stdout).toContain('No entries to undo.');
  });

  test('export bundle then import into a second home', () => {
    run('add', 'one', '-t', 'a,b');
    run('add', 'two', '-d', 'more words');
    const file = path.join(home, 'b.json');
    const exp = run('export', '--format', 'bundle', '-o', file);
    expect(exp.status).toBe(0);
    const home2 = mkHome();
    try {
      const imp = runIn(home2, ['import', file]);
      expect(imp.status).toBe(0);
      expect(imp.stdout).toContain('Imported: 2 new, 0 updated, 0 unchanged, 0 duplicates merged.');
      expect(rows(home2).map((r) => r.id)).toEqual(rows(home).map((r) => r.id));
      expect(runIn(home2, ['import', file]).stdout).toContain('Imported: 0 new, 0 updated, 2 unchanged, 0 duplicates merged.');
      fs.writeFileSync(file, '{nope');
      const bad = runIn(home2, ['import', file]);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain(`Bundle file ${file} is not valid JSON:`);
    } finally {
      fs.rmSync(home2, { recursive: true, force: true });
    }
  });

  test('a 200 char summary is split, with a note, and details hold the full text', () => {
    const long = `${'word '.repeat(40)}end`;
    const r = run('add', long);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Note: summary was long, the rest went to details.');
    const [row] = rows(home);
    expect((row.summary as string).length).toBeLessThanOrEqual(120);
    expect(row.details).toBe(long);
  });

  test('a long summary with -d keeps both', () => {
    const long = `${'word '.repeat(40)}end`;
    expect(run('add', long, '-d', 'extra').status).toBe(0);
    expect(rows(home)[0].details).toBe(`${long}\n\nextra`);
  });

  test('clear with no TTY deletes nothing', () => {
    run('add', 'keep me');
    const r = run('clear');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Not a terminal; nothing cleared.');
    expect(rows(home).filter((r) => r.deleted_at === null)).toHaveLength(1);
  });

  test('find and log show the short id', () => {
    const id = suffix(run('add', 'findable thing').stdout);
    expect(run('find', 'findable').stdout).toContain(id);
    expect(run('log').stdout).toContain(id);
    expect(run('tags').stdout).toContain('No tags found.');
    const projects = run('projects');
    expect(projects.status).toBe(0);
    expect(projects.stdout).toMatch(/^\S+  1$/m);
    const stats = run('stats');
    expect(stats.status).toBe(0);
    expect(stats.stdout).toContain('Total entries: 1');
    const standup = run('standup');
    expect(standup.status).toBe(0);
    expect(standup.stdout).toContain('findable thing');
  });

  test('find matches text that is only in the details', () => {
    run('add', 'plain summary', '-d', 'Has a Needle inside');
    const r = run('find', 'needle');
    expect(r.stdout).toContain('Found 1 entries');
    expect(run('find', 'absent').stdout).toContain('Found 0 entries');
  });

  test('an unknown export format is an error on stderr only', () => {
    const r = run('export', '-f', 'xml');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Unknown format "xml". Use md, csv, or bundle.');
  });
});

describe('bundle restore with migrated entries', () => {
  const legacy = [
    { timestamp: '2026-07-29T10:00:00.000Z', message: 'One', project: 'a', tags: [] as string[] },
    { timestamp: '2026-07-30T10:00:00.000Z', message: 'Two', project: 'a', tags: [] as string[] },
  ];
  let home: string;
  beforeEach(() => {
    home = mkHome();
    fs.writeFileSync(path.join(home, 'entries.json'), JSON.stringify(legacy));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
  const live = () => rows(home, 'SELECT id FROM entries WHERE deleted_at IS NULL').length;

  test('export, delete the database, import: still 2 live entries', () => {
    expect(runIn(home, ['stats']).status).toBe(0);
    const file = path.join(home, 'b.json');
    expect(runIn(home, ['export', '--format', 'bundle', '-o', file]).status).toBe(0);
    for (const f of ['gournal.db', 'gournal.db-wal', 'gournal.db-shm']) fs.rmSync(path.join(home, f), { force: true });
    const imp = runIn(home, ['import', file]);
    expect(imp.status).toBe(0);
    expect(imp.stdout).toContain('Imported: 2 new, 0 updated, 0 unchanged, 0 duplicates merged.');
    expect(live()).toBe(2);
    expect(rows(home, 'SELECT id FROM entries').length).toBe(2);
  });

  test('an already migrated database merges the duplicates of a bundle of the same lines', () => {
    const other = mkHome();
    try {
      fs.writeFileSync(path.join(other, 'entries.json'), JSON.stringify(legacy));
      expect(runIn(other, ['stats']).status).toBe(0);
      const file = path.join(other, 'b.json');
      expect(runIn(other, ['export', '--format', 'bundle', '-o', file]).status).toBe(0);
      expect(runIn(home, ['stats']).status).toBe(0);
      const imp = runIn(home, ['import', file]);
      expect(imp.status).toBe(0);
      expect(imp.stdout).toContain('Imported: 2 new, 0 updated, 0 unchanged, 2 duplicates merged.');
      expect(live()).toBe(2);
      expect(rows(home, 'SELECT id FROM entries WHERE deleted_at IS NOT NULL').length).toBe(2);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
