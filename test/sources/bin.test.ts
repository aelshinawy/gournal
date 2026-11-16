import { resolveBin, resolveWinShim } from '../../src/sources';

const CWD = 'C:\\work\\repo';

function fakeExists(...present: string[]): (file: string) => boolean {
  const set = new Set(present.map((f) => f.toLowerCase()));
  return (file) => set.has(file.toLowerCase());
}

describe('resolveBin', () => {
  test('on Windows it returns the absolute path of the first PATH hit', () => {
    const exists = fakeExists('C:\\Git\\cmd\\git.exe', 'C:\\Other\\git.exe');
    const env = { PATH: 'C:\\Windows;C:\\Git\\cmd;C:\\Other' };
    expect(resolveBin('git', { platform: 'win32', env, exists, cwd: CWD })).toBe('C:\\Git\\cmd\\git.exe');
  });

  test('on Windows it scans the entries in order', () => {
    const seen: string[] = [];
    const exists = (f: string): boolean => { seen.push(f); return f === 'C:\\b\\gh.exe'; };
    resolveBin('gh', { platform: 'win32', env: { PATH: 'C:\\a;C:\\b;C:\\c' }, exists, cwd: CWD });
    expect(seen).toEqual(['C:\\a\\gh.exe', 'C:\\b\\gh.exe']);
  });

  test('the key Path matches as well as PATH', () => {
    const exists = fakeExists('C:\\Tools\\git.exe');
    expect(resolveBin('git', { platform: 'win32', env: { Path: 'C:\\Tools' }, exists, cwd: CWD })).toBe('C:\\Tools\\git.exe');
  });

  test('empty entries, ".", and the current directory are skipped', () => {
    const exists = (f: string): boolean => f.toLowerCase().startsWith('c:\\work\\repo') || f === '.\\git.exe' || f === '\\git.exe';
    const env = { PATH: ';.;C:\\WORK\\Repo;C:\\work\\repo\\;"C:\\Work\\REPO"' };
    expect(resolveBin('git', { platform: 'win32', env, exists, cwd: CWD })).toBe('git');
  });

  test('a relative entry is skipped', () => {
    const exists = () => true;
    expect(resolveBin('git', { platform: 'win32', env: { PATH: 'bin;..\\tools' }, exists, cwd: CWD })).toBe('git');
  });

  test('double quotes around an entry are removed', () => {
    const exists = fakeExists('C:\\Program Files\\Git\\cmd\\git.exe');
    const env = { PATH: '"C:\\Program Files\\Git\\cmd"' };
    expect(resolveBin('git', { platform: 'win32', env, exists, cwd: CWD })).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
  });

  test('only the .exe form counts, never .cmd or .bat', () => {
    const exists = fakeExists('C:\\Tools\\claude.cmd', 'C:\\Tools\\claude.bat');
    expect(resolveBin('claude', { platform: 'win32', env: { PATH: 'C:\\Tools' }, exists, cwd: CWD })).toBe('claude');
  });

  test('it falls back to the bare name when nothing is found or PATH is missing', () => {
    expect(resolveBin('git', { platform: 'win32', env: { PATH: 'C:\\a;C:\\b' }, exists: () => false, cwd: CWD })).toBe('git');
    expect(resolveBin('git', { platform: 'win32', env: {}, exists: () => true, cwd: CWD })).toBe('git');
  });

  test('a configured bare name such as GOURNAL_GH=mygh is resolved like any other name', () => {
    const exists = fakeExists('C:\\Tools\\mygh.exe');
    expect(resolveBin('mygh', { platform: 'win32', env: { PATH: 'C:\\Tools' }, exists, cwd: CWD })).toBe('C:\\Tools\\mygh.exe');
    // A planted file in the current folder is not a match.
    expect(resolveBin('mygh', { platform: 'win32', env: { PATH: 'C:\\work\\repo' }, exists: fakeExists('C:\\work\\repo\\mygh.exe'), cwd: CWD })).toBe('mygh');
  });

  test('a name with a path separator is returned as it is', () => {
    expect(resolveBin('C:\\x\\gh.exe', { platform: 'win32', env: { PATH: 'C:\\a' }, exists: () => true, cwd: CWD })).toBe('C:\\x\\gh.exe');
  });

  test.each<NodeJS.Platform>(['linux', 'darwin'])('on %s it returns the bare name and never looks at the disk', (platform) => {
    const exists = jest.fn(() => true);
    expect(resolveBin('git', { platform, env: { PATH: '/usr/bin:/bin' }, exists })).toBe('git');
    expect(exists).not.toHaveBeenCalled();
  });
});

describe('resolveWinShim', () => {
  const opts = (env: NodeJS.ProcessEnv, exists: (f: string) => boolean) => ({ platform: 'win32' as const, env, exists, cwd: CWD });

  test('it returns the absolute path of <name>.cmd from an absolute PATH entry', () => {
    const exists = fakeExists('C:\\Users\\x\\npm\\claude.cmd');
    expect(resolveWinShim('claude', opts({ PATH: 'C:\\Windows;C:\\Users\\x\\npm' }, exists))).toBe('C:\\Users\\x\\npm\\claude.cmd');
  });

  test('the key Path matches as well as PATH', () => {
    expect(resolveWinShim('claude', opts({ Path: 'C:\\T' }, fakeExists('C:\\T\\claude.cmd')))).toBe('C:\\T\\claude.cmd');
  });

  test('the current directory, ".", and empty entries are skipped', () => {
    const exists = (f: string): boolean => f.toLowerCase().startsWith('c:\\work\\repo') || f === '.\\claude.cmd' || f === '\\claude.cmd';
    const env = { PATH: ';.;C:\\WORK\\Repo;C:\\work\\repo\\;"C:\\Work\\REPO"' };
    expect(resolveWinShim('claude', opts(env, exists))).toBeNull();
  });

  test('a relative entry is skipped', () => {
    expect(resolveWinShim('claude', opts({ PATH: 'bin;..\\tools' }, () => true))).toBeNull();
  });

  test('double quotes around an entry are removed', () => {
    const exists = fakeExists('C:\\Program Files\\npm\\claude.cmd');
    expect(resolveWinShim('claude', opts({ PATH: '"C:\\Program Files\\npm"' }, exists))).toBe('C:\\Program Files\\npm\\claude.cmd');
  });

  test('only the .cmd form counts, never .bat or .exe', () => {
    const exists = fakeExists('C:\\T\\claude.bat', 'C:\\T\\claude.exe', 'C:\\T\\claude');
    expect(resolveWinShim('claude', opts({ PATH: 'C:\\T' }, exists))).toBeNull();
  });

  test('it returns null when nothing is found, PATH is missing, or the name holds a separator', () => {
    expect(resolveWinShim('claude', opts({ PATH: 'C:\\a;C:\\b' }, () => false))).toBeNull();
    expect(resolveWinShim('claude', opts({}, () => true))).toBeNull();
    expect(resolveWinShim('C:\\x\\claude', opts({ PATH: 'C:\\a' }, () => true))).toBeNull();
  });

  test.each<NodeJS.Platform>(['linux', 'darwin'])('on %s it returns null and never looks at the disk', (platform) => {
    const exists = jest.fn(() => true);
    expect(resolveWinShim('claude', { platform, env: { PATH: '/usr/bin' }, exists })).toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });
});
