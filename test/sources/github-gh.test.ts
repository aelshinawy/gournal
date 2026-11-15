import path from 'path';
import { execGh, GhError } from '../../src/sources';

const FAKE = path.join(__dirname, '..', 'fixtures', 'github', 'fake-gh.sh');

describe('execGh', () => {
  afterEach(() => { delete process.env.FAKE_GH_MODE; });

  test('returns stdout on success', async () => {
    expect(await execGh(FAKE)(['api', 'user'], { timeoutMs: 2000 })).toContain('"ok":true');
  });

  test.each([
    ['missing', '/nonexistent/gh', 'ok'],
    ['auth', FAKE, 'auth'],
    ['rate-limit', FAKE, 'rate-limit'],
    ['timeout', FAKE, 'sleep'],
    ['network', FAKE, 'network'],
    ['other', FAKE, 'other'],
  ])('%s maps to its GhError kind', async (kind, bin, mode) => {
    process.env.FAKE_GH_MODE = mode;
    const err = await execGh(bin)(['api', 'user'], { timeoutMs: 300 }).catch((e) => e);
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
