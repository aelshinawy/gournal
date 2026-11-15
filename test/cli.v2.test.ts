import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { format, startOfWeek } from 'date-fns';
import { runIn } from './helpers/run-cli';
import { openJournal } from '../src/storage/journal';
import { ftsTest } from './fts5';

const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-cli-v2-'));
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

  test('add -k blocker, then resolve', async () => {
    const add = await run('add', 'Stuck on CI', '-k', 'blocker');
    expect(add.status).toBe(0);
    expect(add.stdout).toMatch(/✓ Entry added! \([0-9A-Z]{8}\)/);
    const id = suffix(add.stdout);
    const res = await run('resolve', id);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Stuck on CI');
    expect(rows(home)[0].status).toBe('resolved');
  });

  test('add --resolves closes a blocker, and a bad id is an error', async () => {
    const id = suffix((await run('add', 'Blocked', '-k', 'blocker')).stdout);
    expect((await run('add', 'Fixed it', '--resolves', id)).status).toBe(0);
    expect(rows(home)[0].status).toBe('resolved');
    const bad = await run('add', 'Nope', '--resolves', 'ZZZZZZZZ');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('No entry with id');
    expect(rows(home)).toHaveLength(2);
  });

  test('add rejects an unknown kind', async () => {
    const r = await run('add', 'x', '-k', 'wat');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown kind "wat". Use done, blocker, or next.');
    expect(fs.existsSync(path.join(home, 'gournal.db')) ? rows(home) : []).toEqual([]);
  });

  test('undo, then restore', async () => {
    await run('add', 'first');
    await run('add', 'second');
    const undo = await run('undo');
    expect(undo.status).toBe(0);
    expect(undo.stdout).toMatch(/✓ Removed: second \(restore with gournal restore [0-9A-Z]{8}\)/);
    const id = /restore ([0-9A-Z]{8})\)/.exec(undo.stdout)![1];
    expect(rows(home).filter((r) => r.deleted_at === null).map((r) => r.summary)).toEqual(['first']);
    const restore = await run('restore', id);
    expect(restore.status).toBe(0);
    expect(restore.stdout).toContain('second');
    expect(rows(home).filter((r) => r.deleted_at === null).map((r) => r.summary)).toEqual(['first', 'second']);
  });

  test('undo on an empty journal', async () => {
    expect((await run('undo')).stdout).toContain('No entries to undo.');
  });

  test('export bundle then import into a second home', async () => {
    await run('add', 'one', '-t', 'a,b');
    await run('add', 'two', '-d', 'more words');
    const file = path.join(home, 'b.json');
    const exp = await run('export', '--format', 'bundle', '-o', file);
    expect(exp.status).toBe(0);
    const home2 = mkHome();
    try {
      const imp = await runIn(home2, ['import', file]);
      expect(imp.status).toBe(0);
      expect(imp.stdout).toContain('Imported: 2 new, 0 updated, 0 unchanged, 0 duplicates merged.');
      expect(rows(home2).map((r) => r.id)).toEqual(rows(home).map((r) => r.id));
      expect((await runIn(home2, ['import', file])).stdout).toContain('Imported: 0 new, 0 updated, 2 unchanged, 0 duplicates merged.');
      fs.writeFileSync(file, '{nope');
      const bad = await runIn(home2, ['import', file]);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain(`Bundle file ${file} is not valid JSON:`);
    } finally {
      fs.rmSync(home2, { recursive: true, force: true });
    }
  });

  test('a 200 char summary is split, with a note, and details hold the full text', async () => {
    const long = `${'word '.repeat(40)}end`;
    const r = await run('add', long);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Note: summary was long, the rest went to details.');
    const [row] = rows(home);
    expect((row.summary as string).length).toBeLessThanOrEqual(120);
    expect(row.details).toBe(long);
  });

  test('a long summary with -d keeps both', async () => {
    const long = `${'word '.repeat(40)}end`;
    expect((await run('add', long, '-d', 'extra')).status).toBe(0);
    expect(rows(home)[0].details).toBe(`${long}\n\nextra`);
  });

  test('clear with no TTY deletes nothing', async () => {
    await run('add', 'keep me');
    const r = await run('clear');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Not a terminal; nothing cleared.');
    expect(rows(home).filter((r) => r.deleted_at === null)).toHaveLength(1);
  });

  test('find and log show the short id', async () => {
    const id = suffix((await run('add', 'findable thing')).stdout);
    expect((await run('find', 'findable')).stdout).toContain(id);
    expect((await run('log')).stdout).toContain(id);
    expect((await run('tags')).stdout).toContain('No tags found.');
    const projects = await run('projects');
    expect(projects.status).toBe(0);
    expect(projects.stdout).toMatch(/^\S+  1$/m);
    const stats = await run('stats');
    expect(stats.status).toBe(0);
    expect(stats.stdout).toContain('Total entries: 1');
    const standup = await run('standup');
    expect(standup.status).toBe(0);
    expect(standup.stdout).toContain('findable thing');
  });

  test('find matches text that is only in the details', async () => {
    await run('add', 'plain summary', '-d', 'Has a Needle inside');
    const r = await run('find', 'needle');
    expect(r.stdout).toContain('Found 1 entries');
    expect((await run('find', 'absent')).stdout).toContain('Found 0 entries');
  });

  test('an unknown export format is an error on stderr only', async () => {
    const r = await run('export', '-f', 'xml');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Unknown format "xml". Use md, csv, or bundle.');
  });

  describe('add stores repo identity', () => {
    let tmpBase: string;
    let repoDir: string;
    beforeEach(() => {
      tmpBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-git-')));
      repoDir = path.join(tmpBase, 'collection-app');
      fs.mkdirSync(repoDir);
      const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-C', repoDir, ...a], { stdio: 'ignore' });
      g('init'); g('remote', 'add', 'origin', 'git@github.com:acme/collection-app.git');
      g('commit', '--allow-empty', '-m', 'i'); g('checkout', '-b', 'lane-b');
    });
    afterEach(() => fs.rmSync(tmpBase, { recursive: true, force: true }));
    const stored = () => rows(home, 'SELECT project, repo, branch FROM entries');

    test('project, repo, and branch come from the cwd', async () => {
      expect((await runIn(home, ['add', 'x'], { cwd: repoDir })).status).toBe(0);
      expect(stored()).toEqual([{ project: 'collection-app', repo: 'acme/collection-app', branch: 'lane-b' }]);
    });

    test('config projectAliases reach resolveIdentity', async () => {
      fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ projectAliases: { 'acme/collection-app': 'Collection' } }));
      expect((await runIn(home, ['add', 'x'], { cwd: repoDir })).status).toBe(0);
      expect(stored()[0]).toMatchObject({ project: 'Collection', repo: 'acme/collection-app' });
    });
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

  test('export, delete the database, import: still 2 live entries', async () => {
    expect((await runIn(home, ['stats'])).status).toBe(0);
    const file = path.join(home, 'b.json');
    expect((await runIn(home, ['export', '--format', 'bundle', '-o', file])).status).toBe(0);
    for (const f of ['gournal.db', 'gournal.db-wal', 'gournal.db-shm']) fs.rmSync(path.join(home, f), { force: true });
    const imp = await runIn(home, ['import', file]);
    expect(imp.status).toBe(0);
    expect(imp.stdout).toContain('Imported: 2 new, 0 updated, 0 unchanged, 0 duplicates merged.');
    expect(live()).toBe(2);
    expect(rows(home, 'SELECT id FROM entries').length).toBe(2);
  });

  test('import into an empty database takes no daily backup, a non-empty one does', async () => {
    const other = mkHome();
    try {
      fs.writeFileSync(path.join(other, 'entries.json'), JSON.stringify(legacy));
      expect((await runIn(other, ['stats'])).status).toBe(0);
      const file = path.join(other, 'b.json');
      expect((await runIn(other, ['export', '--format', 'bundle', '-o', file])).status).toBe(0);
      const fresh = mkHome();
      try {
        expect((await runIn(fresh, ['import', file])).status).toBe(0);
        expect(fs.existsSync(path.join(fresh, 'backups'))).toBe(false);
        // The second import finds entries, so the day's backup is taken now.
        expect((await runIn(fresh, ['import', file])).status).toBe(0);
        expect(fs.readdirSync(path.join(fresh, 'backups')).filter((n) => /^gournal-\d{4}-\d{2}-\d{2}\.db$/.test(n))).toHaveLength(1);
      } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('an already migrated database merges the duplicates of a bundle of the same lines', async () => {
    const other = mkHome();
    try {
      fs.writeFileSync(path.join(other, 'entries.json'), JSON.stringify(legacy));
      expect((await runIn(other, ['stats'])).status).toBe(0);
      const file = path.join(other, 'b.json');
      expect((await runIn(other, ['export', '--format', 'bundle', '-o', file])).status).toBe(0);
      expect((await runIn(home, ['stats'])).status).toBe(0);
      const imp = await runIn(home, ['import', file]);
      expect(imp.status).toBe(0);
      expect(imp.stdout).toContain('Imported: 2 new, 0 updated, 0 unchanged, 2 duplicates merged.');
      expect(live()).toBe(2);
      expect(rows(home, 'SELECT id FROM entries WHERE deleted_at IS NOT NULL').length).toBe(2);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('gournal CLI reads on Query and renderers', () => {
  let home: string;
  beforeEach(() => { home = mkHome(); });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
  const run = (...args: string[]) => runIn(home, args);
  // eslint-disable-next-line no-control-regex
  const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
  const daysAgo = (n: number, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const seed = (items: { summary: string; kind?: 'done' | 'blocker' | 'next'; createdAt: string; details?: string }[]) => {
    const j = openJournal(home);
    try {
      return items.map((i) => j.repo.add({ project: 'p', source: 'cli', ...i }));
    } finally {
      j.close();
    }
  };

  test('standup shows an open blocker from an earlier day', async () => {
    seed([{ summary: 'Stuck on CI', kind: 'blocker', createdAt: daysAgo(2) }]);
    const r = await run('standup');
    expect(r.status).toBe(0);
    expect(plain(r.stdout)).toContain('Blockers');
    expect(plain(r.stdout)).toContain('Stuck on CI');
  });

  test('a resolved blocker leaves the standup', async () => {
    const [b] = seed([{ summary: 'Stuck on CI', kind: 'blocker', createdAt: daysAgo(2) }]);
    expect((await run('resolve', b.id.slice(-8))).status).toBe(0);
    const r = await run('standup');
    expect(plain(r.stdout)).not.toContain('Blockers');
    expect(plain(r.stdout)).not.toContain('Stuck on CI');
  });

  test('staleAfterDays from config.json moves items to Stale', async () => {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ staleAfterDays: 1 }));
    seed([{ summary: 'Old blocker', kind: 'blocker', createdAt: daysAgo(2) }]);
    const r = plain((await run('standup')).stdout);
    expect(r).toContain('Stale: 1 open item older than 1 days');
    expect(r).not.toContain('Blockers');
  });

  test('weekStartsOn 0 changes the weekly title', async () => {
    seed([{ summary: 'x', createdAt: new Date().toISOString() }]);
    const title = async () => plain((await run('standup', '--week')).stdout).match(/Weekly \((.*?) - /)![1];
    expect(await title()).toBe(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'MMM dd'));
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ weekStartsOn: 0 }));
    expect(await title()).toBe(format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'MMM dd'));
  });

  test('find --kind blocker,next --status open lists only open items', async () => {
    const [b] = seed([
      { summary: 'blocker one', kind: 'blocker', createdAt: daysAgo(1) },
      { summary: 'blocker two', kind: 'blocker', createdAt: daysAgo(1) },
      { summary: 'next one', kind: 'next', createdAt: daysAgo(1) },
      { summary: 'done one', createdAt: daysAgo(1) },
    ]);
    await run('resolve', b.id.slice(-8));
    const r = await run('find', 'one', '--kind', 'blocker,next', '--status', 'open');
    expect(r.stdout).toContain('Found 1 entries:');
    expect(r.stdout).toContain('next one');
    expect(r.stdout).not.toContain('blocker one');
    expect(r.stdout).not.toContain('done one');
  });

  test('find rejects a bad kind, status, and limit before opening the journal', async () => {
    const k = await run('find', 'x', '--kind', 'done,wat');
    expect(k.status).toBe(1);
    expect(k.stderr).toContain('Unknown kind "wat". Use done, blocker, or next.');
    const s = await run('find', 'x', '--status', 'closed');
    expect(s.status).toBe(1);
    expect(s.stderr).toContain('Unknown status "closed". Use open or resolved.');
    const l = await run('find', 'x', '-n', '0');
    expect(l.status).toBe(1);
    expect(l.stderr).toContain('limit must be a positive integer');
    expect(fs.existsSync(path.join(home, 'gournal.db'))).toBe(false);
  });

  test('find -n limits the results', async () => {
    seed([
      { summary: 'alpha a', createdAt: daysAgo(3) },
      { summary: 'alpha b', createdAt: daysAgo(2) },
    ]);
    expect((await run('find', 'alpha', '-n', '1')).stdout).toContain('Found 1 entries:');
  });

  test('find uses text search over details', async () => {
    seed([{ summary: 'plain', details: 'contains zebra word', createdAt: daysAgo(1) }]);
    expect((await run('find', 'zebra')).stdout).toContain('Found 1 entries:');
  });

  test('log --from --to covers whole local days', async () => {
    const late = new Date();
    late.setDate(late.getDate() - 3);
    late.setHours(23, 30, 0, 0);
    seed([
      { summary: 'late entry', createdAt: late.toISOString() },
      { summary: 'outside entry', createdAt: daysAgo(5) },
    ]);
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = await run('log', '--from', day(late), '--to', day(late));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('late entry');
    expect(r.stdout).not.toContain('outside entry');
  });

  test('a bad --from exits 1 with Invalid date, before opening the journal', async () => {
    for (const cmd of ['standup', 'log']) {
      const r = await run(cmd, '--from', 'soon');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Invalid date: soon');
    }
    const e = await run('export', '--to', 'soon');
    expect(e.status).toBe(1);
    expect(fs.existsSync(path.join(home, 'gournal.db'))).toBe(false);
  });

  test('export --from --to narrows md and csv output', async () => {
    seed([
      { summary: 'in range', createdAt: '2026-03-10T10:00:00.000Z' },
      { summary: 'out of range', createdAt: '2026-01-10T10:00:00.000Z' },
    ]);
    const md = await run('export', '--from', '2026-03-09', '--to', '2026-03-11');
    expect(md.stdout).toContain('in range');
    expect(md.stdout).not.toContain('out of range');
    const csv = await run('export', '-f', 'csv', '--from', '2026-03-09');
    expect(csv.stdout).toContain('in range');
    expect(csv.stdout).not.toContain('out of range');
  });

  ftsTest('index rebuild prints the count', async () => {
    seed([{ summary: 'one', createdAt: daysAgo(1) }]);
    const r = await run('index', 'rebuild');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Search index rebuilt: 1 entries.');
  });

  test('index rebuild without FTS5 refuses and keeps the daily backup slot', async () => {
    seed([{ summary: 'one', createdAt: daysAgo(1) }]);
    fs.rmSync(path.join(home, 'backups'), { recursive: true, force: true }); // the seed write took the day's backup
    const prev = process.env.GOURNAL_DISABLE_FTS5;
    process.env.GOURNAL_DISABLE_FTS5 = '1';
    try {
      const r = await run('index', 'rebuild');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('This Node build has no FTS5; the search index cannot be rebuilt.');
      const dir = path.join(home, 'backups');
      const daily = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^gournal-\d{4}-\d{2}-\d{2}\.db$/.test(n)) : [];
      expect(daily).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.GOURNAL_DISABLE_FTS5; else process.env.GOURNAL_DISABLE_FTS5 = prev;
    }
  });
});
