import { execFile, execFileSync } from 'child_process';
import { execGh, resolveIdentity } from '../../src/sources';
import { resolveBin } from '../../src/sources/bin';

jest.mock('child_process', () => ({ execFile: jest.fn(), execFileSync: jest.fn() }));
jest.mock('../../src/sources/bin', () => ({ resolveBin: jest.fn((name: string) => `RESOLVED-${name}`) }));

const execFileSyncMock = execFileSync as unknown as jest.Mock;
const execFileMock = execFile as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GOURNAL_GH;
});

describe('git identity', () => {
  test('every git call uses the resolved binary and a hidden window', () => {
    execFileSyncMock.mockReturnValue('');
    resolveIdentity('/some/dir', {});
    expect(resolveBin).toHaveBeenCalledWith('git');
    expect(execFileSyncMock).toHaveBeenCalled();
    for (const call of execFileSyncMock.mock.calls) {
      expect(call[0]).toBe('RESOLVED-git');
      expect(call[2]).toMatchObject({ windowsHide: true });
    }
  });

  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  test('an error inside the lookup falls back to the default project', () => {
    execFileSyncMock.mockImplementation((_b: string, args: string[]) => {
      if (args.includes('rev-parse')) return '/top\n/top/.git';
      if (args.includes('symbolic-ref')) return 'main';
      return '';
    });
    const boom = () => { throw new Error('boom'); };
    const aliases = new Proxy({}, { has: boom, get: boom, getOwnPropertyDescriptor: boom, ownKeys: boom });
    expect(resolveIdentity('/x', aliases as Record<string, string>)).toEqual({ project: 'uncategorized', repo: null, branch: null });
  });
});

describe('gh', () => {
  const run = (bin?: string): void => {
    execFileMock.mockImplementation((_f: string, _a: string[], _o: unknown, cb: (e: null, out: string, err: string) => void) => cb(null, 'ok', ''));
    void execGh(bin)(['api', 'user'], { timeoutMs: 100 });
  };

  test('the default name goes through resolveBin', () => {
    run();
    expect(execFileMock.mock.calls[0]![0]).toBe('RESOLVED-gh');
    expect(execFileMock.mock.calls[0]![2]).toMatchObject({ windowsHide: true });
  });

  test('a bare GOURNAL_GH name goes through resolveBin, so the current folder is never searched', () => {
    process.env.GOURNAL_GH = 'my-gh';
    run();
    expect(resolveBin).toHaveBeenCalledWith('my-gh');
    expect(execFileMock.mock.calls[0]![0]).toBe('RESOLVED-my-gh');
  });

  test('GOURNAL_GH wins over the default name', () => {
    process.env.GOURNAL_GH = '/custom/gh';
    run();
    expect(resolveBin).toHaveBeenCalledWith('/custom/gh');
    expect(resolveBin).not.toHaveBeenCalledWith('gh');
  });

  test('an explicit bin wins over GOURNAL_GH', () => {
    process.env.GOURNAL_GH = '/custom/gh';
    run('/explicit/gh');
    expect(resolveBin).toHaveBeenCalledTimes(1);
    expect(resolveBin).toHaveBeenCalledWith('/explicit/gh');
    expect(execFileMock.mock.calls[0]![0]).toBe('RESOLVED-/explicit/gh');
  });
});
