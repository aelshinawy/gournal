import fs from 'fs';
import path from 'path';
import { GhError, type GhRunner } from '../src/sources';
import { openJournal, type Journal } from '../src/storage/journal';
import { AUTO_SYNC_BUDGET_MS, SYNC_LEASE, SYNC_STATE, maybeAutoSync, relinkAfterWrite, runSync } from '../src/adapters/sync';
import { fakeGh } from './helpers/fake-gh';
import { makeTmp, rmTmp } from './helpers/tmp';

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github', n), 'utf8'));
const NOW = new Date('2026-11-15T12:00:00.000Z');
const DAY = 86_400_000;
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Routes for a sync whose `since` is the given date. */
function routes(since: Date) {
  return {
    user: fx('user.json'),
    [`search/issues?order=asc&page=1&per_page=100&q=is:pr author:Dev updated:>=${stamp(since)}&sort=updated`]: fx('search-authored-p1.json'),
    [`search/issues?order=asc&page=1&per_page=100&q=is:pr reviewed-by:Dev -author:Dev updated:>=${stamp(since)}&sort=updated`]: fx('search-reviewed-p1.json'),
    'repos/acme/widgets/pulls/5': fx('pull-acme-widgets-5.json'),
    'repos/acme/widgets/pulls/5/commits?page=1&per_page=100': fx('commits-acme-widgets-5.json'),
    'repos/blocked-org/vault/pulls/2': { ...fx('pull-acme-widgets-5.json'), number: 2 },
    'repos/blocked-org/vault/pulls/2/commits?page=1&per_page=100': [],
    'repos/octo/app/pulls/9/reviews?page=1&per_page=100': fx('reviews-octo-app-9.json'),
  };
}
const throwing = (kind: ConstructorParameters<typeof GhError>[0]): GhRunner => async () => { throw new GhError(kind, `gh ${kind}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRS = [1, 2, 3, 4].map((n) => ({ number: n, updated: `2026-11-0${n + 1}T00:00:00Z` }));
const prRoutes = (since: Date, list: typeof PRS) => {
  const r: Record<string, unknown> = {
    user: { login: 'Dev' },
    [`search/issues?order=asc&page=1&per_page=100&q=is:pr author:Dev updated:>=${stamp(since)}&sort=updated`]: {
      items: list.map((p) => ({ number: p.number, title: `PR ${p.number}`, repository_url: 'https://api.github.com/repos/acme/x', user: { login: 'Dev' }, updated_at: p.updated })),
    },
    [`search/issues?order=asc&page=1&per_page=100&q=is:pr reviewed-by:Dev -author:Dev updated:>=${stamp(since)}&sort=updated`]: { items: [] },
  };
  for (const p of PRS) {
    r[`repos/acme/x/pulls/${p.number}`] = { number: p.number, title: `PR ${p.number}`, html_url: `u${p.number}`, head: { ref: `b${p.number}` }, state: 'open', created_at: p.updated, base: { ref: 'main' } };
    r[`repos/acme/x/pulls/${p.number}/commits?page=1&per_page=100`] = [];
  }
  return r;
};
const pullCalls = (gh: { calls: string[][] }) => gh.calls.map((c) => c[1]).filter((x) => /^repos\/acme\/x\/pulls\/\d$/.test(x));
/** Wraps a runner so that every commits call after the first `max` times out. */
const timeoutAfterCommits = (inner: GhRunner, max: number): GhRunner => {
  let commits = 0;
  return async (a, o) => {
    if (a.some((x) => x.includes('/commits'))) { commits += 1; if (commits > max) throw new GhError('timeout', 'gh timed out'); }
    return inner(a, o);
  };
};
const syncGh = (since: Date, partial: boolean): GhRunner =>
  partial ? timeoutAfterCommits(fakeGh(prRoutes(since, PRS)), 2) : fakeGh(routes(since));

let home: string;
let journal: Journal;
let other: Journal;
const savedNoAuto = process.env.GOURNAL_NO_AUTOSYNC;
beforeEach(() => {
  delete process.env.GOURNAL_NO_AUTOSYNC; // the global setup sets it; the gate tests need it unset
  home = makeTmp('gournal-sync-');
  journal = openJournal(home);
  other = openJournal(home);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (savedNoAuto === undefined) delete process.env.GOURNAL_NO_AUTOSYNC;
  else process.env.GOURNAL_NO_AUTOSYNC = savedNoAuto;
  journal.close();
  other.close();
  rmTmp(home);
});

const cursor = () => journal.repo.getState(SYNC_STATE.cursor);

test('first sync covers initialSyncDays', async () => {
  const since = new Date(NOW.getTime() - 30 * DAY);
  const gh = fakeGh(routes(since));
  const r = await runSync(journal, gh, { auto: false, now: NOW });
  expect(r).toMatchObject({ status: 'ok', since: since.toISOString(), warning: null });
  expect(r.inserted).toBeGreaterThan(0);
  expect(gh.calls.some((c) => c.join(' ').includes(`updated:>=${stamp(since)}`))).toBe(true);
  expect(journal.repo.getState(SYNC_STATE.login)).toBe('Dev');
  expect(cursor()).toBe(NOW.toISOString());
  expect(journal.repo.getState(SYNC_STATE.lastSyncAt)).toBe(NOW.toISOString());
  expect(journal.repo.getState(SYNC_STATE.lastAttemptAt)).toBe(NOW.toISOString());
});

test('second sync starts at the previous sync start', async () => {
  await runSync(journal, fakeGh(routes(new Date(NOW.getTime() - 30 * DAY))), { auto: false, now: NOW });
  const later = new Date(NOW.getTime() + 2 * DAY);
  const gh = fakeGh(routes(NOW));
  const r = await runSync(journal, gh, { auto: false, now: later });
  expect(r.status).toBe('ok');
  expect(r.since).toBe(NOW.toISOString());
  expect(r).toMatchObject({ inserted: 0, updated: 0 });
  expect(cursor()).toBe(later.toISOString());
  expect(gh.calls[0]).not.toEqual(['api', 'user']); // the login is cached
});

test.each([false, true])('--since backfills but never moves the cursor back (partial: %s)', async (partial) => {
  await runSync(journal, fakeGh(routes(new Date(NOW.getTime() - 30 * DAY))), { auto: false, now: NOW });
  const stored = cursor();
  const older = new Date(NOW.getTime() - 90 * DAY);
  const later = new Date(NOW.getTime() + DAY);
  const r = await runSync(journal, syncGh(older, partial), { since: older, auto: false, now: later });
  expect(r.since).toBe(older.toISOString());
  expect(r.status).toBe(partial ? 'partial' : 'ok');
  // A full sync moves the cursor forward to its start. A partial one stops at its last finished PR.
  const after = cursor();
  expect(after).toBe(partial ? stored : later.toISOString());
  // A sync that starts before the stored cursor must not move it back.
  const evenLater = new Date(NOW.getTime() - 5 * DAY);
  await runSync(journal, syncGh(older, partial), { since: older, auto: false, now: evenLater });
  expect(cursor()).toBe(after);
});

test.each([false, true])('a manual --since later than the cursor leaves the cursor unchanged (partial: %s)', async (partial) => {
  await runSync(journal, fakeGh(routes(new Date(NOW.getTime() - 30 * DAY))), { auto: false, now: NOW });
  const since = new Date(NOW.getTime() + DAY);
  const r = await runSync(journal, syncGh(since, partial), { since, auto: false, now: new Date(NOW.getTime() + 2 * DAY) });
  expect(r.status).toBe(partial ? 'partial' : 'ok');
  expect(cursor()).toBe(NOW.toISOString());
});

test('an auto partial sync with no finished PR keeps the skipped line and the cursor', async () => {
  const since = new Date(NOW.getTime() - 30 * DAY);
  const inner = fakeGh(routes(since));
  let n = 0;
  const gh: GhRunner = async (a, o) => { n += 1; if (n > 3) throw new GhError('timeout', 'gh timed out'); return inner(a, o); };
  const r = await runSync(journal, gh, { auto: true, now: NOW });
  expect(r.status).toBe('partial');
  expect(r.warning).toBe('gournal: GitHub sync skipped (timed out after 10 s); showing stored activity');
  expect(cursor()).toBeNull();
});

test.each([
  ['timeout', 'Stopped early (a GitHub call timed out); run gournal sync again to continue.'],
  ['rate-limit', 'Stopped early (GitHub rate limit reached); run gournal sync again to continue.'],
] as const)('a manual %s names the reason, claims no 10 s limit, and sets a continue hint', async (kind, warning) => {
  const inner = fakeGh(routes(new Date(NOW.getTime() - 30 * DAY)));
  let n = 0;
  const gh: GhRunner = async (a, o) => { n += 1; if (n > 5) throw new GhError(kind, 'gh stopped'); return inner(a, o); };
  const r = await runSync(journal, gh, { auto: false, now: NOW });
  expect(r.status).toBe('partial');
  expect(r.warning).toBe(warning);
});

describe('monotonic progress', () => {
  test('a partial auto sync advances the cursor to the last finished PR, and the next one continues there', async () => {
    const since = new Date(NOW.getTime() - 30 * DAY);
    const first = fakeGh(prRoutes(since, PRS));
    let commits = 0;
    const cut: GhRunner = async (a, o) => {
      if (a.some((x) => x.includes('/commits'))) { commits += 1; if (commits > 2) throw new GhError('timeout', 'gh timed out'); }
      return first(a, o);
    };
    const r1 = await runSync(journal, cut, { auto: true, now: NOW });
    expect(r1.status).toBe('partial');
    expect(r1.warning).toBe('gournal: GitHub sync stopped early (timed out after 10 s); run gournal sync to catch up');
    expect(r1.inserted).toBeGreaterThan(0);
    expect(journal.activity.find().length).toBe(r1.inserted);
    expect(cursor()).toBe('2026-11-03T00:00:00Z');
    expect(journal.repo.getState(SYNC_STATE.lastSyncAt)).toBeNull();

    const later = new Date(NOW.getTime() + 20 * 60_000);
    const second = fakeGh(prRoutes(new Date('2026-11-03T00:00:00Z'), PRS.slice(1)));
    const r2 = await runSync(journal, second, { auto: true, now: later });
    expect(r2).toMatchObject({ status: 'ok', warning: null, since: '2026-11-03T00:00:00.000Z' });
    expect(cursor()).toBe(later.toISOString());
    // PR 1 is fetched once in total. PR 2 is the one that was in flight, and may repeat.
    expect([...pullCalls(first), ...pullCalls(second)].filter((x) => x.endsWith('/1'))).toHaveLength(1);
  });

});

test('the auto deadline stops the fetch between calls', async () => {
  const since = new Date(NOW.getTime() - 30 * DAY);
  const inner = fakeGh(routes(since));
  let clock = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const gh: GhRunner = async (args, o) => {
    clock += AUTO_SYNC_BUDGET_MS + 1;
    return inner(args, o);
  };
  const r = await runSync(journal, gh, { auto: true, now: NOW });
  expect(r.status).toBe('partial');
  expect(inner.calls.length).toBe(1);
  expect(cursor()).toBeNull();
});

test('concurrent syncs use one lease and make no duplicates', async () => {
  const since = new Date(NOW.getTime() - 30 * DAY);
  const slow = (): GhRunner => {
    const inner = fakeGh(routes(since));
    return async (a, o) => { await sleep(20); return inner(a, o); };
  };
  const [a, b] = await Promise.all([
    runSync(journal, slow(), { auto: true, now: NOW }),
    runSync(other, slow(), { auto: false, now: NOW }),
  ]);
  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual(['failed', 'ok']);
  const failed = a.status === 'failed' ? a : b;
  expect(failed.warning).toBe('Another GitHub sync is running; try again in a minute.');
  const single = openJournal(makeTmp('gournal-sync-one-'));
  await runSync(single, fakeGh(routes(since)), { auto: false, now: NOW });
  expect(journal.activity.find().length).toBe(single.activity.find().length);
  single.close();
});

test('an auto sync that cannot take the lease is skipped without a warning', async () => {
  expect(journal.activity.tryLease(SYNC_LEASE, 'someone-else', 60_000)).toBe(true);
  const gh = fakeGh(routes(new Date(NOW.getTime() - 30 * DAY)));
  const r = await runSync(other, gh, { auto: true, now: NOW });
  expect(r).toMatchObject({ status: 'skipped', warning: null });
  expect(gh.calls).toHaveLength(0);
  expect(other.repo.getState(SYNC_STATE.lastAttemptAt)).toBeNull();
});

test('the lease is released after a sync, also after a failure', async () => {
  await runSync(journal, throwing('auth'), { auto: false, now: NOW });
  expect(journal.activity.tryLease(SYNC_LEASE, 'next', 1000)).toBe(true);
});

test('a non-GhError never escapes and maps to the other reason', async () => {
  const gh: GhRunner = async () => '{not json at all';
  const r = await runSync(journal, gh, { auto: false, now: NOW });
  expect(r.status).toBe('failed');
  expect(r.warning).toMatch(/^GitHub sync failed \(.+\)$/);
  const long: GhRunner = async () => { throw new TypeError(`${'x'.repeat(300)}\nsecond`); };
  const r2 = await runSync(journal, long, { auto: true, now: NOW });
  expect(r2.status).toBe('failed');
  expect(r2.warning).toBe(`gournal: GitHub sync skipped (${'x'.repeat(100)}); showing stored activity`);
});

test('a manual sync without gh fails with the install hint', async () => {
  const r = await runSync(journal, throwing('missing'), { auto: false, now: NOW });
  expect(r).toMatchObject({ status: 'failed', warning: 'GitHub sync failed (gh is not installed; see https://cli.github.com)' });
});

describe('auto sync gate', () => {
  const ok = (since: Date) => fakeGh(routes(since));

  test('runs only when autoSync is on and the last attempt is older than autoSyncMinutes', async () => {
    const since = new Date(NOW.getTime() - 30 * DAY);
    const g1 = ok(since);
    expect(await maybeAutoSync(journal, g1, NOW)).toBeNull();
    expect(g1.calls.length).toBeGreaterThan(0);

    const soon = new Date(NOW.getTime() + 14 * 60_000);
    const g2 = ok(NOW);
    await maybeAutoSync(journal, g2, soon);
    expect(g2.calls).toHaveLength(0);

    const due = new Date(NOW.getTime() + 16 * 60_000);
    const g3 = ok(NOW);
    await maybeAutoSync(journal, g3, due);
    expect(g3.calls.length).toBeGreaterThan(0);

    const g4 = ok(due);
    await maybeAutoSync({ ...journal, config: { ...journal.config, github: { ...journal.config.github, autoSync: false } } }, g4, new Date(due.getTime() + DAY));
    expect(g4.calls).toHaveLength(0);

    // The config loader reads the override, so open the journal again with it set.
    process.env.GOURNAL_NO_AUTOSYNC = '1';
    const muted = openJournal(home);
    try {
      const g5 = ok(due);
      await maybeAutoSync(muted, g5, new Date(due.getTime() + DAY));
      expect(g5.calls).toHaveLength(0);
    } finally {
      muted.close();
    }
  });

  test('a failed attempt counts as an attempt', async () => {
    expect(await maybeAutoSync(journal, throwing('auth'), NOW)).toContain('not signed in');
    const gh = ok(NOW);
    expect(await maybeAutoSync(journal, gh, new Date(NOW.getTime() + 60_000))).toBeNull();
    expect(gh.calls).toHaveLength(0);
  });

  test('without gh it stays silent and never blocks', async () => {
    const later = new Date(NOW.getTime() + 60 * 60_000);
    expect(await maybeAutoSync(journal, throwing('missing'), NOW)).toBeNull();
    expect(await maybeAutoSync(journal, throwing('auth'), later))
      .toBe('gournal: GitHub sync skipped (gh is not signed in; run gh auth login); showing stored activity');
  });

  test('a raw error never throws out of maybeAutoSync', async () => {
    const gh: GhRunner = async () => { throw new SyntaxError('Unexpected token'); };
    expect(await maybeAutoSync(journal, gh, NOW)).toBe('gournal: GitHub sync skipped (Unexpected token); showing stored activity');
  });
});

describe('relinkAfterWrite', () => {
  test('it never throws and warns once per process', () => {
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const broken = { activity: { relinkEntries: () => { throw new Error('boom'); } } } as unknown as Journal;
    expect(() => relinkAfterWrite(broken, ['a'])).not.toThrow();
    expect(() => relinkAfterWrite(broken, ['b'])).not.toThrow();
    const warnings = write.mock.calls.filter((c) => String(c[0]).includes('relink'));
    expect(warnings.length).toBeLessThanOrEqual(1);
  });
});
