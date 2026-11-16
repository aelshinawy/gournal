import { msysToWindowsPath, resolveCallIdentity } from '../../src/adapters/mcp/identity';

describe('msysToWindowsPath', () => {
  test.each([
    ['/c/Users/x/repo', 'C:/Users/x/repo'],
    ['/C/Users/x', 'C:/Users/x'],
    ['/d/work', 'D:/work'],
    ['/c', 'C:/'],
    ['/c/', 'C:/'],
  ])('on win32 %s becomes %s', (input, expected) => {
    expect(msysToWindowsPath(input, 'win32')).toBe(expected);
  });

  test.each(['/cd/Users', '/usr/local', '/', 'C:\\Users\\x', 'C:/Users/x', 'repo', '\\\\server\\share'])(
    'on win32 %s stays as it is',
    (input) => {
      expect(msysToWindowsPath(input, 'win32')).toBe(input);
    },
  );

  test.each<NodeJS.Platform>(['linux', 'darwin'])('on %s it never changes a path', (platform) => {
    expect(msysToWindowsPath('/c/Users/x', platform)).toBe('/c/Users/x');
  });
});

describe('resolveCallIdentity on Windows', () => {
  const base = { project: 'p', repo: 'o/r', branch: 'main' };
  const makeDeps = (platform: NodeJS.Platform) => ({
    identity: jest.fn(() => base),
    roots: async () => ['C:/root'],
    processCwd: () => 'C:/proc',
    platform,
  });

  test('an MSYS cwd reaches the identity lookup as a drive path', async () => {
    const deps = makeDeps('win32');
    await resolveCallIdentity({ cwd: '/c/Users/x/repo' }, deps);
    expect(deps.identity).toHaveBeenCalledWith('C:/Users/x/repo');
  });

  test('a relative cwd still counts as absent', async () => {
    const deps = makeDeps('win32');
    await resolveCallIdentity({ cwd: 'repo' }, deps);
    expect(deps.identity).toHaveBeenCalledWith('C:/root');
  });

  test('on Linux the same cwd is already absolute and stays unchanged', async () => {
    const deps = makeDeps('linux');
    await resolveCallIdentity({ cwd: '/c/Users/x/repo' }, deps);
    expect(deps.identity).toHaveBeenCalledWith('/c/Users/x/repo');
  });
});
