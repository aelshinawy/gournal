import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { formatMonthDay, startOfWeek } from '../src/core/dates';
import { runIn } from './helpers/run-cli';
import { openJournal } from '../src/storage/journal';
import { ftsTest } from './fts5';
import { GhError, type GhRunner } from '../src/sources';
import type { NewActivityInput } from '../src/core';
import { makeRealTmp, makeTmp, rmTmp } from './helpers/tmp';

const mkHome = () => makeTmp('gournal-cli-v2-');
const rows = (home: string, sql = 'SELECT id, summary, details, status, deleted_at FROM entries ORDER BY created_at') => {
  const db = new DatabaseSync(path.join(home, 'gournal.db'));
  try { return db.prepare(sql).all() as Record<string, string | number | null>[]; } finally { db.close(); }
};
const suffix = (stdout: string) => /\(([0-9A-Z]{8})\)/.exec(stdout)![1];

describe('gournal CLI on the SQLite journal', () => {
  let home: string;
  beforeEach(() => { home = mkHome(); });
  afterEach(() => rmTmp(home));
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

  test('add --resolves drops a bad id with a note and keeps the entry', async () => {
    const id = suffix((await run('add', 'Blocked', '-k', 'blocker')).stdout);
    const r = await run('add', 'Fixed it', '--resolves', `${id},ZZZZZZZZ`);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^✓ Entry added! \([0-9A-Z]{8}\)$/);
    expect(r.stderr).toBe('Could not resolve ZZZZZZZZ: No entry with id "ZZZZZZZZ"');
    expect(rows(home).map((x) => x.status)).toEqual(['resolved', null]);
  });

  test('a commander usage error goes through io.err with status 1 and exits no process', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit(${code})`); }) as typeof process.exit);
    try {
      for (const args of [['add', 'x', '--bogus'], ['setup', 'claude', '--bogus']]) {
        const r = await run(...args);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("unknown option '--bogus'");
        expect(r.stdout).toBe('');
      }
      expect(exit).not.toHaveBeenCalled();
    } finally { exit.mockRestore(); }
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
    const restore = await run('restore', id);
    expect(restore.status).toBe(0);
    expect(restore.stdout).toContain('second');
  });

  test('add with a near-duplicate tag prints a similar-tag note on stderr', async () => {
    await run('add', 'first', '-t', 'review');
    const r = await run('add', 'second', '-t', 'reveiw');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^✓ Entry added! \([0-9A-Z]{8}\)$/);
    expect(r.stderr).toBe('New tag "reveiw". Close existing tags: review');
  });

  test('add prints similar-tag notes, then dropped resolves, on stderr', async () => {
    await run('add', 'first', '-t', 'review');
    const r = await run('add', 'second', '-t', 'reveiw', '--resolves', 'ZZZZZZZZ');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(['New tag "reveiw". Close existing tags: review', 'Could not resolve ZZZZZZZZ: No entry with id "ZZZZZZZZ"'].join('\n'));
  });

  test('a split add prints the added line, then the note, and nothing else', async () => {
    const r = await run('add', `${'word '.repeat(40)}end`);
    expect(r.stdout).toMatch(/^✓ Entry added! \([0-9A-Z]{8}\)\nNote: summary was long, the rest went to details\.$/);
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
      rmTmp(home2);
    }
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
      tmpBase = makeRealTmp('gournal-git-');
      repoDir = path.join(tmpBase, 'collection-app');
      fs.mkdirSync(repoDir);
      const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-C', repoDir, ...a], { stdio: 'ignore' });
      g('init'); g('remote', 'add', 'origin', 'git@github.com:acme/collection-app.git');
      g('commit', '--allow-empty', '-m', 'i'); g('checkout', '-b', 'lane-b');
    });
    afterEach(() => rmTmp(tmpBase));
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

test('import into an empty database takes no daily backup, a non-empty one does', async () => {
  const other = mkHome();
  const fresh = mkHome();
  try {
    const j = openJournal(other);
    try { j.repo.add({ summary: 'One', project: 'a', source: 'cli' }); } finally { j.close(); }
    const file = path.join(other, 'b.json');
    expect((await runIn(other, ['export', '--format', 'bundle', '-o', file])).status).toBe(0);
    expect((await runIn(fresh, ['import', file])).status).toBe(0);
    expect(fs.existsSync(path.join(fresh, 'backups'))).toBe(false);
    // The second import finds entries, so the day's backup is taken now.
    expect((await runIn(fresh, ['import', file])).status).toBe(0);
    expect(fs.readdirSync(path.join(fresh, 'backups')).filter((n) => /^gournal-\d{4}-\d{2}-\d{2}\.db$/.test(n))).toHaveLength(1);
  } finally {
    rmTmp(other);
    rmTmp(fresh);
  }
});

describe('gournal CLI reads on Query and renderers', () => {
  let home: string;
  beforeEach(() => { home = mkHome(); });
  afterEach(() => rmTmp(home));
  const run = (...args: string[]) => runIn(home, args);
  // eslint-disable-next-line no-control-regex
  const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
  const daysAgo = (n: number, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const seed = (items: { summary: string; kind?: 'done' | 'blocker' | 'next'; createdAt: string; details?: string; project?: string; tags?: string[] }[]) => {
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
    expect(r).toContain('Stale: 1 open item older than 1 day');
    expect(r).not.toContain('Blockers');
  });

  test('an open blocker older than --from still shows (carry-forward)', async () => {
    seed([{ summary: 'Old blocker', kind: 'blocker', createdAt: daysAgo(5) }]);
    const day = new Date();
    day.setDate(day.getDate() - 2);
    const from = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const r = plain((await run('standup', '--from', from)).stdout);
    expect(r).toContain('Blockers');
    expect(r).toContain('Old blocker');
  });

  test('the open query honours --project and --tags', async () => {
    seed([
      { summary: 'Alpha blocker', kind: 'blocker', createdAt: daysAgo(2), project: 'alpha', tags: ['red'] },
      { summary: 'Beta blocker', kind: 'blocker', createdAt: daysAgo(2), project: 'beta', tags: ['blue'] },
    ]);
    const byProject = plain((await run('standup', '-p', 'alpha')).stdout);
    expect(byProject).toContain('Alpha blocker');
    expect(byProject).not.toContain('Beta blocker');
    const byTag = plain((await run('standup', '-t', 'blue')).stdout);
    expect(byTag).toContain('Beta blocker');
    expect(byTag).not.toContain('Alpha blocker');
  });

  test('weekStartsOn 0 changes the weekly title', async () => {
    seed([{ summary: 'x', createdAt: new Date().toISOString() }]);
    const title = async () => plain((await run('standup', '--week')).stdout).match(/Weekly \((.*?) - /)![1];
    expect(await title()).toBe(formatMonthDay(startOfWeek(new Date(), 1)));
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ weekStartsOn: 0 }));
    expect(await title()).toBe(formatMonthDay(startOfWeek(new Date(), 0)));
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

  test('--from overrides --week', async () => {
    seed([{ summary: 'old entry', createdAt: daysAgo(20) }]);
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const old = new Date(daysAgo(20));
    const weekOnly = await run('log', '--week');
    expect(weekOnly.status).toBe(0);
    expect(weekOnly.stdout).not.toContain('old entry');
    const both = await run('log', '--week', '--from', day(old), '--to', day(old));
    expect(both.status).toBe(0);
    expect(both.stdout).toContain('old entry');
    const standup = await run('standup', '--week', '--from', day(old), '--to', day(old));
    expect(standup.stdout).toContain('Range (');
    expect(standup.stdout).not.toContain('Weekly');
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

  ftsTest('index rebuild takes the daily backup first', async () => {
    seed([{ summary: 'one', createdAt: daysAgo(1) }]);
    rmTmp(path.join(home, 'backups')); // the seed write took the day's backup
    const r = await run('index', 'rebuild');
    expect(r.status).toBe(0);
    const daily = fs.readdirSync(path.join(home, 'backups')).filter((n) => /^gournal-\d{4}-\d{2}-\d{2}\.db$/.test(n));
    expect(daily).toHaveLength(1);
  });

  test('index rebuild without FTS5 refuses and keeps the daily backup slot', async () => {
    seed([{ summary: 'one', createdAt: daysAgo(1) }]);
    rmTmp(path.join(home, 'backups')); // the seed write took the day's backup
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

describe('standup and log with GitHub activity', () => {
  let home: string;
  const savedNoAuto = process.env.GOURNAL_NO_AUTOSYNC;
  beforeEach(() => { home = mkHome(); });
  afterEach(() => {
    rmTmp(home);
    if (savedNoAuto === undefined) delete process.env.GOURNAL_NO_AUTOSYNC; else process.env.GOURNAL_NO_AUTOSYNC = savedNoAuto;
  });

  const activity = (over: Partial<NewActivityInput> & { externalId: string }): NewActivityInput => ({
    type: 'pr_merged', occurredAt: new Date().toISOString(), repo: 'acme/widgets', branch: null,
    title: 'Add widget cache', url: null, pr: 327, payload: { pr: 327 }, ...over,
  });
  const seedActivity = (items: NewActivityInput[], aliases?: Record<string, string>) => {
    if (aliases) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ projectAliases: aliases }));
    const j = openJournal(home);
    try { j.activity.upsert(items); } finally { j.close(); }
  };
  const seedEntry = (summary: string, project = 'widgets') => {
    const j = openJournal(home);
    try { j.repo.add({ summary, project, source: 'cli' }); } finally { j.close(); }
  };

  test('standup collapses the Also list, and --activity expands it', async () => {
    seedActivity([activity({ externalId: 'm327' }), activity({ type: 'review', externalId: 'r412', repo: 'octo/app', pr: 412, title: 'Fix login redirect', payload: { pr: 412 } })]);
    const plain = await runIn(home, ['standup']);
    expect(plain.stdout).toContain('Also: 1 PR merged, 1 review in 2 repos (--activity to expand)');
    const full = await runIn(home, ['standup', '--activity']);
    expect(full.status).toBe(0);
    expect(full.stdout).toContain('Also happened');
    expect(full.stdout).toContain('acme/widgets');
    expect(full.stdout).toMatch(/merged\s+#327/);
    expect(full.stdout).not.toContain('--activity to expand');
  });

  test('log folds linked activity under its entry and has no Also section', async () => {
    seedActivity([activity({ externalId: 'm5', pr: 5, payload: { pr: 5 }, title: 'Add x' })]);
    const j = openJournal(home);
    try {
      const e = j.repo.add({ summary: 'Shipped x', project: 'widgets', source: 'cli', repo: 'acme/widgets', refs: [{ type: 'pr', value: '5' }] });
      j.activity.relinkEntries([e.id]);
    } finally { j.close(); }
    const r = await runIn(home, ['log']);
    expect(r.stdout).toContain('↳ merged #5 Add x');
    expect(r.stdout).not.toContain('Also');
  });

  test('project filter keeps only activity whose repo maps to the project', async () => {
    seedActivity([
      activity({ externalId: 'a', repo: 'acme/widgets', pr: 1, payload: { pr: 1 }, title: 'Widget thing' }),
      activity({ externalId: 'b', repo: 'octo/gears', pr: 2, payload: { pr: 2 }, title: 'Gear thing' }),
      activity({ externalId: 'c', repo: 'acme/legacy-app', pr: 3, payload: { pr: 3 }, title: 'Aliased thing' }),
    ], { 'acme/legacy-app': 'widgets' });
    const widgets = await runIn(home, ['standup', '--activity', '-p', 'widgets']);
    expect(widgets.stdout).toContain('Widget thing');
    expect(widgets.stdout).toContain('Aliased thing');
    expect(widgets.stdout).not.toContain('Gear thing');
    const gears = await runIn(home, ['standup', '--activity', '-p', 'GEARS']);
    expect(gears.stdout).toContain('Gear thing');
    expect(gears.stdout).not.toContain('Widget thing');
  });

  test('repo filter compares without case', async () => {
    seedActivity([
      activity({ externalId: 'a', repo: 'acme/widgets', title: 'Widget thing' }),
      activity({ externalId: 'b', repo: 'octo/gears', pr: 2, payload: { pr: 2 }, title: 'Gear thing' }),
    ]);
    const r = await runIn(home, ['standup', '--activity', '--repo', 'ACME/Widgets']);
    expect(r.stdout).toContain('Widget thing');
    expect(r.stdout).not.toContain('Gear thing');
  });

  test('tags filter hides the Also section', async () => {
    seedActivity([activity({ externalId: 'a' })]);
    const j = openJournal(home);
    try { j.repo.add({ summary: 'Tagged work', project: 'widgets', source: 'cli', tags: ['bug'] }); } finally { j.close(); }
    const r = await runIn(home, ['standup', '--activity', '-t', 'bug']);
    expect(r.stdout).toContain('Tagged work');
    expect(r.stdout).not.toContain('Also');
  });

  test('standup prints the sync warning on stderr and still prints the standup', async () => {
    delete process.env.GOURNAL_NO_AUTOSYNC;
    seedEntry('Did a thing');
    const gh: GhRunner = async () => { throw new GhError('auth', 'x'); };
    const r = await runIn(home, ['standup'], { gh });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('gournal: GitHub sync skipped (gh is not signed in; run gh auth login); showing stored activity');
    expect(r.stdout).toContain('Did a thing');
  });

  test('log runs auto-sync too, and a missing gh stays silent', async () => {
    delete process.env.GOURNAL_NO_AUTOSYNC;
    seedEntry('Did a thing');
    const down: GhRunner = async () => { throw new GhError('auth', 'x'); };
    const r = await runIn(home, ['log'], { gh: down });
    expect(r.stderr).toContain('GitHub sync skipped');
    expect(r.stdout).toContain('Did a thing');
    const home2 = mkHome();
    try {
      const j = openJournal(home2);
      try { j.repo.add({ summary: 'Other', project: 'p', source: 'cli' }); } finally { j.close(); }
      const missing: GhRunner = async () => { throw new GhError('missing', 'x'); };
      const q = await runIn(home2, ['log'], { gh: missing });
      expect(q.stderr).toBe('');
      expect(q.stdout).toContain('Other');
    } finally { rmTmp(home2); }
  });

  test('a bad option fails before any sync runs', async () => {
    delete process.env.GOURNAL_NO_AUTOSYNC;
    const gh = jest.fn(async () => '{}') as unknown as GhRunner;
    const r = await runIn(home, ['standup', '--from', 'nope'], { gh });
    expect(r.status).toBe(1);
    expect(gh).not.toHaveBeenCalled();
  });
});
