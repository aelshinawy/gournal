import path from 'path';
import { execGh, GhError } from '../../src/sources';

const FAKE = path.join(__dirname, '..', 'fixtures', 'github', 'fake-gh.js');
// Windows cannot start a script directly. Run the fake as a Node script on every system.
const fakeGh = (): ReturnType<typeof execGh> => execGh(process.execPath, [FAKE]);

describe('execGh', () => {
  afterEach(() => { delete process.env.FAKE_GH_MODE; });

  test('returns stdout on success', async () => {
    expect(await fakeGh()(['api', 'user'], { timeoutMs: 2000 })).toContain('"ok":true');
  });

  test('prefix args go before the gh arguments', async () => {
    process.env.FAKE_GH_MODE = 'args';
    const out = await fakeGh()(['api', 'user'], { timeoutMs: 2000 });
    expect(JSON.parse(out)).toEqual(['api', 'user']);
  });

  test.each([
    ['missing', 'ok'],
    ['auth', 'auth'],
    ['rate-limit', 'rate-limit'],
    ['timeout', 'sleep'],
    ['network', 'network'],
    ['other', 'other'],
  ])('%s maps to its GhError kind', async (kind, mode) => {
    process.env.FAKE_GH_MODE = mode;
    const run = kind === 'missing' ? execGh('/nonexistent/gh') : fakeGh();
    // Only the sleep case may time out. A slow Node start on Windows must not turn the other cases into timeouts.
    const err = await run(['api', 'user'], { timeoutMs: mode === 'sleep' ? 300 : 4000 }).catch((e) => e);
    expect(err).toBeInstanceOf(GhError);
    expect(err.kind).toBe(kind);
    if (kind === 'other') expect(err.message).toBe('something odd');
  });

  test('bin defaults to GOURNAL_GH', async () => {
    process.env.GOURNAL_GH = '/nonexistent/gh';
    try {
      const err = await execGh()(['api', 'user'], { timeoutMs: 300 }).catch((e) => e);
      expect(err.kind).toBe('missing');
    } finally { delete process.env.GOURNAL_GH; }
  });
});
