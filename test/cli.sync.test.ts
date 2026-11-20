import fs from 'fs';
import path from 'path';
import { GhError, type GhRunner } from '../src/sources';
import { runIn } from './helpers/run-cli';
import { makeTmp, rmTmp } from './helpers/tmp';

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github', n), 'utf8'));

/** Accepts any since value: one route per search query shape is resolved by prefix. */
function anyDateGh(): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = (async (args: string[]) => {
    calls.push(args);
    const j = args.join(' ');
    if (j === 'api user') return JSON.stringify(fx('user.json'));
    if (j.includes('search/issues') && j.includes('is:pr author:')) return JSON.stringify(fx('search-authored-p1.json'));
    if (j.includes('search/issues')) return JSON.stringify(fx('search-reviewed-p1.json'));
    if (j.includes('repos/acme/widgets/pulls/5/commits')) return JSON.stringify(fx('commits-acme-widgets-5.json'));
    if (j.includes('repos/acme/widgets/pulls/5')) return JSON.stringify(fx('pull-acme-widgets-5.json'));
    if (j.includes('blocked-org/vault') && j.includes('commits')) return '[]';
    if (j.includes('blocked-org/vault')) return JSON.stringify({ ...fx('pull-acme-widgets-5.json'), number: 2 });
    if (j.includes('octo/app/pulls/9/reviews')) return JSON.stringify(fx('reviews-octo-app-9.json'));
    throw new GhError('other', `no route ${j}`);
  }) as unknown as GhRunner & { calls: string[][] };
  run.calls = calls;
  return run;
}

let home: string;
beforeEach(() => { home = makeTmp('gournal-cli-sync-'); });
afterEach(() => rmTmp(home));

test('gournal sync prints counts', async () => {
  const r = await runIn(home, ['sync'], { gh: anyDateGh() });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/^Synced GitHub activity since [A-Z][a-z]{2} \d{2}: \d+ new, \d+ updated, \d+ links\.$/);
  expect(r.stdout).toMatch(/: [1-9]\d* new, 0 updated/);
});

test('gournal sync --since rejects a bad date', async () => {
  const gh = anyDateGh();
  const r = await runIn(home, ['sync', '--since', 'nope'], { gh });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('Invalid date "nope"');
  expect(gh.calls).toHaveLength(0);
});

test('gournal sync --since takes a local day', async () => {
  const gh = anyDateGh();
  const r = await runIn(home, ['sync', '--since', '2026-10-01'], { gh });
  expect(r.status).toBe(0);
  expect(gh.calls.some((c) => c.join(' ').includes('updated:>='))).toBe(true);
});

test('gournal sync exits 1 and prints the reason when it fails', async () => {
  const gh: GhRunner = async () => { throw new GhError('auth', 'x'); };
  const r = await runIn(home, ['sync'], { gh });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('gh is not signed in; run gh auth login');
});

test('gournal sync appends the stop reason when partial', async () => {
  const inner = anyDateGh();
  let n = 0;
  const gh: GhRunner = async (a, o) => { n += 1; if (n > 4) throw new GhError('rate-limit', 'l'); return inner(a, o); };
  const r = await runIn(home, ['sync'], { gh });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/links\. Stopped early \(GitHub rate limit reached\); run gournal sync again to continue\.$/);
});

describe('the sync spinner', () => {
  const KEYS = ['CI', 'TERM', 'GOURNAL_NO_AUTOSYNC'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    delete process.env.CI;
    delete process.env.GOURNAL_NO_AUTOSYNC;
    process.env.TERM = 'xterm';
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** Waits 40 ms before each gh call, so the spinner has time to draw. */
  const slow = (gh: GhRunner): GhRunner => async (args, opts) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return gh(args, opts);
  };

  function stream(isTTY: boolean): { isTTY: boolean; chunks: string[]; write(chunk: string): boolean } {
    const chunks: string[] = [];
    return { isTTY, chunks, write: (chunk) => { chunks.push(chunk); return true; } };
  }

  test('gournal sync draws on a terminal and clears the line', async () => {
    const s = stream(true);
    const r = await runIn(home, ['sync'], { gh: slow(anyDateGh()), spinnerStream: s });
    expect(r.status).toBe(0);
    expect(s.chunks[0]).toBe('\r| Syncing GitHub activity');
    expect(s.chunks[s.chunks.length - 1]).toBe(`\r${' '.repeat(25)}\r`);
    expect(r.stdout).toMatch(/^Synced GitHub activity since /);
  });

  test('gournal sync writes no frame to a pipe', async () => {
    const s = stream(false);
    const r = await runIn(home, ['sync'], { gh: slow(anyDateGh()), spinnerStream: s });
    expect(r.status).toBe(0);
    expect(s.chunks).toEqual([]);
    expect(r.stderr).not.toContain('Syncing GitHub activity');
  });

  test.each(['standup', 'log'])('the auto-sync before %s draws on a terminal', async (cmd) => {
    const s = stream(true);
    const r = await runIn(home, [cmd], { gh: slow(anyDateGh()), spinnerStream: s });
    expect(r.status).toBe(0);
    expect(s.chunks[0]).toBe('\r| Syncing GitHub activity');
  });

  test('an auto-sync that is not due draws nothing', async () => {
    await runIn(home, ['sync'], { gh: anyDateGh() });
    const s = stream(true);
    const r = await runIn(home, ['standup'], { gh: slow(anyDateGh()), spinnerStream: s });
    expect(r.status).toBe(0);
    expect(s.chunks).toEqual([]);
  });
});
