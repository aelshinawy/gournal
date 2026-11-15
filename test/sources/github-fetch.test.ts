import fs from 'fs';
import path from 'path';
import { fetchActivity, GhError, type GhRunner } from '../../src/sources';
import { fakeGh } from '../helpers/fake-gh';

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'github', n), 'utf8'));
const since = new Date('2026-11-01T00:00:00.123Z');
const Q_OWN = 'is:pr author:Dev updated:>=2026-11-01T00:00:00Z';
const Q_REV = 'is:pr reviewed-by:Dev -author:Dev updated:>=2026-11-01T00:00:00Z';
const none = { include: [] as string[], exclude: [] as string[] };

function routes(extra: Record<string, unknown> = {}) {
  return {
    user: fx('user.json'),
    [`search/issues?order=asc&page=1&per_page=100&q=${Q_OWN}&sort=updated`]: fx('search-authored-p1.json'),
    [`search/issues?order=asc&page=1&per_page=100&q=${Q_REV}&sort=updated`]: fx('search-reviewed-p1.json'),
    'repos/acme/widgets/pulls/5': fx('pull-acme-widgets-5.json'),
    'repos/acme/widgets/pulls/5/commits?page=1&per_page=100': fx('commits-acme-widgets-5.json'),
    'repos/blocked-org/vault/pulls/2': { ...fx('pull-acme-widgets-5.json'), number: 2 },
    'repos/blocked-org/vault/pulls/2/commits?page=1&per_page=100': [],
    'repos/octo/app/pulls/9/reviews?page=1&per_page=100': fx('reviews-octo-app-9.json'),
    ...extra,
  };
}

describe('fetchActivity', () => {
  test('maps own PR, merge, and commits from recorded responses', async () => {
    const gh = fakeGh(routes());
    const r = await fetchActivity(gh, { since, owners: none, callTimeoutMs: 1000 });
    expect(r.complete).toBe(true);
    expect(r.stoppedBy).toBeNull();
    expect(r.login).toBe('Dev');
    expect(r.items.filter((i) => i.type === 'pr_merged' && i.repo === 'acme/widgets')).toEqual([{
      type: 'pr_merged', occurredAt: '2026-11-03T15:00:00Z', repo: 'acme/widgets', branch: 'feat/x',
      externalId: '5', title: 'Add widget cache', url: 'https://github.com/acme/widgets/pull/5',
      pr: 5, payload: { pr: 5, mergedBy: 'dev' },
    }]);
    expect(r.items.find((i) => i.type === 'pr_opened' && i.repo === 'acme/widgets')).toEqual({
      type: 'pr_opened', occurredAt: '2026-11-02T09:00:00Z', repo: 'acme/widgets', branch: 'feat/x',
      externalId: '5', title: 'Add widget cache', url: 'https://github.com/acme/widgets/pull/5',
      pr: 5, payload: { pr: 5, state: 'closed', draft: false, base: 'main' },
    });
    const commits = r.items.filter((i) => i.type === 'commit' && i.repo === 'acme/widgets');
    expect(commits).toEqual([{
      type: 'commit', occurredAt: '2026-11-02T10:00:00Z', repo: 'acme/widgets', branch: 'feat/x',
      externalId: 'abcdef1234567890abcdef1234567890abcdef12', title: 'Add cache layer',
      url: 'https://github.com/acme/widgets/commit/abcdef1234567890abcdef1234567890abcdef12',
      pr: 5, payload: { pr: 5 },
    }]);
    expect(gh.calls[0]).toEqual(['api', 'user']);
    expect(gh.calls).toContainEqual(['api', '-X', 'GET', 'search/issues', '-f', `q=${Q_OWN}`, '-f', 'per_page=100', '-f', 'page=1', '-f', 'sort=updated', '-f', 'order=asc']);
    expect(gh.calls).toContainEqual(['api', 'repos/acme/widgets/pulls/5']);
  });

  test('both searches ask for ascending updated order', async () => {
    const gh = fakeGh(routes());
    await fetchActivity(gh, { since, owners: none, callTimeoutMs: 1000 });
    const searches = gh.calls.filter((c) => c.includes('search/issues'));
    expect(searches).toHaveLength(2);
    for (const c of searches) expect(c.join(' ')).toContain('-f sort=updated -f order=asc');
  });

  test('reviews on own PRs are skipped and pending reviews are ignored', async () => {
    const gh = fakeGh(routes());
    const r = await fetchActivity(gh, { since, owners: none, callTimeoutMs: 1000 });
    const reviews = r.items.filter((i) => i.type === 'review');
    expect(reviews).toEqual([{
      type: 'review', occurredAt: '2026-11-04T08:00:00Z', repo: 'octo/app', branch: null,
      externalId: '9001', title: 'Fix app routing', url: 'https://github.com/octo/app/pull/9#pullrequestreview-9001',
      pr: 9, payload: { pr: 9, state: 'APPROVED' },
    }]);
    expect(gh.calls.some((c) => c.join(' ').includes('pulls/10'))).toBe(false);
  });

  test('commits by other authors are skipped', async () => {
    const r = await fetchActivity(fakeGh(routes()), { since, owners: none, callTimeoutMs: 1000 });
    const shas = r.items.filter((i) => i.type === 'commit').map((i) => i.externalId);
    expect(shas).not.toContain('1111111222222233333334444444555555566666');
    expect(shas).not.toContain('9999999888888877777776666666555555544444');
  });

  test('owners include and exclude filter repos case-insensitively', async () => {
    const ex = await fetchActivity(fakeGh(routes()), { since, owners: { include: [], exclude: ['Blocked-Org'] }, callTimeoutMs: 1000 });
    expect(ex.items.some((i) => i.repo.startsWith('blocked-org/'))).toBe(false);
    expect(ex.items.some((i) => i.repo === 'acme/widgets')).toBe(true);
    const gh = fakeGh(routes());
    const inc = await fetchActivity(gh, { since, owners: { include: ['OCTO'], exclude: [] }, callTimeoutMs: 1000 });
    expect([...new Set(inc.items.map((i) => i.repo))]).toEqual(['octo/app']);
    expect(gh.calls.some((c) => c.join(' ').includes('repos/acme'))).toBe(false);
  });

  test('search pages until a short page and stops at 10 pages', async () => {
    const mk = (n: number) => ({ number: n, title: 't', repository_url: 'https://api.github.com/repos/acme/x', user: { login: 'dev' } });
    const full = { items: Array.from({ length: 100 }, (_, i) => mk(i + 1)) };
    const r: Record<string, unknown> = { user: { login: 'dev' } };
    const q = 'is:pr author:dev updated:>=2026-11-01T00:00:00Z';
    for (let p = 1; p <= 12; p++) r[`search/issues?order=asc&page=${p}&per_page=100&q=${q}&sort=updated`] = full;
    r['search/issues?order=asc&page=1&per_page=100&q=is:pr reviewed-by:dev -author:dev updated:>=2026-11-01T00:00:00Z&sort=updated'] = { items: [] };
    const gh = fakeGh(r);
    const res = await fetchActivity(gh, { since, owners: { include: [], exclude: ['acme'] }, callTimeoutMs: 1000 });
    expect(res.complete).toBe(true);
    const own = gh.calls.filter((c) => c.includes('search/issues') && c.some((a) => a.startsWith('q=is:pr author')));
    expect(own).toHaveLength(10);

    const short: Record<string, unknown> = { ...r, [`search/issues?order=asc&page=2&per_page=100&q=${q}&sort=updated`]: { items: [mk(1)] } };
    const gh2 = fakeGh(short);
    await fetchActivity(gh2, { since, owners: { include: [], exclude: ['acme'] }, callTimeoutMs: 1000 });
    expect(gh2.calls.filter((c) => c.some((a) => a.startsWith('q=is:pr author')))).toHaveLength(2);
  });

  test('deadline returns partial items with complete false', async () => {
    const inner = fakeGh(routes());
    const gh: GhRunner = async (args, o) => {
      const out = await inner(args, o);
      if (args.includes('repos/acme/widgets/pulls/5')) await new Promise((res) => setTimeout(res, 150));
      return out;
    };
    const r = await fetchActivity(gh, { since, login: 'Dev', owners: { include: [], exclude: ['blocked-org', 'octo'] }, deadline: Date.now() + 100, callTimeoutMs: 1000 });
    expect(r.complete).toBe(false);
    expect(r.stoppedBy).toBe('timeout');
    expect(r.items.map((i) => i.type).sort()).toEqual(['pr_merged', 'pr_opened']);
    expect(inner.calls.some((c) => c.join(' ').includes('/commits'))).toBe(false);
  });

  test('each call timeout is capped by the time left to the deadline', async () => {
    const gh = fakeGh(routes());
    await fetchActivity(gh, { since, login: 'Dev', owners: none, deadline: Date.now() + 500, callTimeoutMs: 60000 });
    expect(gh.timeouts.length).toBeGreaterThan(0);
    for (const t of gh.timeouts) expect(t).toBeLessThanOrEqual(500);
  });

  test('uses the cached login and skips the user call', async () => {
    const gh = fakeGh(routes());
    await fetchActivity(gh, { since, login: 'Dev', owners: none, callTimeoutMs: 1000 });
    expect(gh.calls).not.toContainEqual(['api', 'user']);
  });

  test('a GhError after the first call returns partial items', async () => {
    const gh = fakeGh(routes({ 'repos/acme/widgets/pulls/5': new GhError('rate-limit', 'slow down') }));
    const r = await fetchActivity(gh, { since, owners: { include: [], exclude: ['blocked-org'] }, callTimeoutMs: 1000 });
    expect(r.complete).toBe(false);
    expect(r.stoppedBy).toBe('rate-limit');
  });

  test('a failing user call throws', async () => {
    const gh = fakeGh(routes({ user: new GhError('auth', 'no login') }));
    await expect(fetchActivity(gh, { since, owners: none, callTimeoutMs: 1000 })).rejects.toMatchObject({ kind: 'auth' });
  });

  describe('progressAt', () => {
    const pr = (n: number, updated: string) => ({
      number: n, title: `PR ${n}`, repository_url: 'https://api.github.com/repos/acme/x', user: { login: 'Dev' }, updated_at: updated,
    });
    const search = (items: unknown[]) => ({ items });
    const pull = (n: number) => ({ number: n, title: `PR ${n}`, html_url: `u${n}`, head: { ref: `b${n}` }, state: 'open', created_at: `2026-11-0${n}T00:00:00Z`, base: { ref: 'main' } });
    const base = (own: unknown[], rev: unknown[], extra: Record<string, unknown> = {}) => {
      const r: Record<string, unknown> = {
        [`search/issues?order=asc&page=1&per_page=100&q=${Q_OWN}&sort=updated`]: search(own),
        [`search/issues?order=asc&page=1&per_page=100&q=${Q_REV}&sort=updated`]: search(rev),
      };
      for (const n of [1, 2, 3, 4]) {
        r[`repos/acme/x/pulls/${n}`] = pull(n);
        r[`repos/acme/x/pulls/${n}/commits?page=1&per_page=100`] = [];
      }
      return { ...r, ...extra };
    };

    test('a complete run reports the last PR and processes both searches by updated_at', async () => {
      const own = [pr(1, '2026-11-02T00:00:00Z'), pr(3, '2026-11-04T00:00:00Z')];
      const rev = [{ ...pr(2, '2026-11-03T00:00:00Z'), user: { login: 'sam' } }];
      const gh = fakeGh(base(own, rev, { 'repos/acme/x/pulls/2/reviews?page=1&per_page=100': [] }));
      const r = await fetchActivity(gh, { since, login: 'Dev', owners: none, callTimeoutMs: 1000 });
      expect(r.complete).toBe(true);
      expect(r.progressAt).toBe('2026-11-04T00:00:00Z');
      const order = gh.calls
        .map((c) => c.find((x) => /^repos\/acme\/x\/pulls\/\d(\/reviews)?$/.test(x)))
        .filter((x): x is string => x !== undefined)
        .map((x) => x.split('/')[4]);
      expect(order).toEqual(['1', '2', '3']);
    });

    test('a partial run reports the updated_at of the last finished PR', async () => {
      const own = [1, 2, 3, 4].map((n) => pr(n, `2026-11-0${n + 1}T00:00:00Z`));
      let done = 0;
      const inner = fakeGh(base(own, []));
      const gh: GhRunner = async (a, o) => {
        if (a.some((x) => x.includes('/commits'))) { done += 1; if (done > 2) throw new GhError('timeout', 't'); }
        return inner(a, o);
      };
      const r = await fetchActivity(gh, { since, login: 'Dev', owners: none, callTimeoutMs: 1000 });
      expect(r.complete).toBe(false);
      expect(r.progressAt).toBe('2026-11-03T00:00:00Z');
    });

    test('progressAt is null when no PR finished', async () => {
      const gh = fakeGh(base([pr(1, '2026-11-02T00:00:00Z')], [], { 'repos/acme/x/pulls/1': new GhError('timeout', 't') }));
      const r = await fetchActivity(gh, { since, login: 'Dev', owners: none, callTimeoutMs: 1000 });
      expect(r).toMatchObject({ complete: false, progressAt: null });
    });
  });
});
