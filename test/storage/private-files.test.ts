import fs from 'fs';
import os from 'os';
import path from 'path';
import { publishExclusive, renameWithRetry, writePrivateFile, writeExportFile } from '../../src/storage/private-files';
import { asPlatform } from '../helpers/platform';
import { rmTmp } from '../helpers/tmp';

const posix = process.platform === 'win32' ? test.skip : test;

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-private-')); });
afterEach(() => rmTmp(tmp));

posix('the temp file is removed when the final rename fails', () => {
  // A directory at the target makes the rename of a file onto it fail.
  const target = path.join(tmp, 'target');
  fs.mkdirSync(target);
  expect(() => writePrivateFile(target, 'data')).toThrow();
  expect(fs.readdirSync(tmp)).toEqual(['target']);
});

posix('the temp file is removed when the exclusive link fails because the target exists', () => {
  const target = path.join(tmp, 'target.txt');
  fs.writeFileSync(target, 'precious');
  expect(() => writePrivateFile(target, 'data', { exclusive: true })).toThrow(/EEXIST/);
  expect(fs.readdirSync(tmp)).toEqual(['target.txt']);
  expect(fs.readFileSync(target, 'utf8')).toBe('precious');
});

const fail = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe('renameWithRetry', () => {
  /** A rename that throws the given codes in order, then works. */
  const flaky = (...codes: string[]) => {
    const calls: Array<[string, string]> = [];
    const rename = (from: string, to: string) => {
      calls.push([from, to]);
      const code = codes[calls.length - 1];
      if (code) throw fail(code);
    };
    return { calls, rename };
  };

  test('on win32 it retries twice after EPERM and then succeeds', () => {
    const { calls, rename } = flaky('EPERM', 'EBUSY');
    const sleep = jest.fn();
    renameWithRetry('a', 'b', { platform: 'win32', rename, sleep });
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('it waits 50 ms between attempts with the injected sleep', () => {
    const { rename } = flaky('EPERM', 'EPERM');
    const sleep = jest.fn();
    renameWithRetry('a', 'b', { platform: 'win32', rename, sleep });
    expect(sleep.mock.calls).toEqual([[50], [50]]);
  });

  test('on win32 it rethrows after the third failure', () => {
    const { calls, rename } = flaky('EPERM', 'EPERM', 'EBUSY', 'EPERM');
    const sleep = jest.fn();
    expect(() => renameWithRetry('a', 'b', { platform: 'win32', rename, sleep })).toThrow('EBUSY');
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test.each(['linux', 'darwin'] as const)('on %s it renames once and rethrows', (platform) => {
    const { calls, rename } = flaky('EPERM', 'EPERM');
    const sleep = jest.fn();
    expect(() => renameWithRetry('a', 'b', { platform, rename, sleep })).toThrow('EPERM');
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test.each(['ENOENT', 'EACCES', 'EXDEV'])('on win32 it does not retry %s', (code) => {
    const { calls, rename } = flaky(code, code);
    const sleep = jest.fn();
    expect(() => renameWithRetry('a', 'b', { platform: 'win32', rename, sleep })).toThrow(code);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('it renames a real file with the default dependencies', () => {
    const from = path.join(tmp, 'from'); const to = path.join(tmp, 'to');
    fs.writeFileSync(from, 'x');
    renameWithRetry(from, to);
    expect(fs.readFileSync(to, 'utf8')).toBe('x');
  });
});

describe('publishExclusive', () => {
  afterEach(() => jest.restoreAllMocks());
  const stage = (data: string) => {
    const tmpFile = path.join(tmp, 'staged.tmp');
    fs.writeFileSync(tmpFile, data);
    return tmpFile;
  };

  test.each(['EPERM', 'ENOSYS', 'ENOTSUP', 'EXDEV', 'EINVAL'])('it falls back to claim and rename when link fails with %s', (code) => {
    jest.spyOn(fs, 'linkSync').mockImplementation(() => { throw fail(code); });
    const target = path.join(tmp, 'target');
    expect(publishExclusive(stage('new'), target)).toBe('rename');
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
  });

  test('it uses a hard link when the file system has them', () => {
    const target = path.join(tmp, 'target');
    expect(publishExclusive(stage('new'), target)).toBe('link');
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
  });

  test('without hard links it never replaces a target that another process made first', () => {
    const target = path.join(tmp, 'target');
    // The other process makes the target after the failed link and before our claim.
    jest.spyOn(fs, 'linkSync').mockImplementation(() => { fs.writeFileSync(target, 'winner'); throw fail('EPERM'); });
    expect(() => publishExclusive(stage('loser'), target)).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(fs.readFileSync(target, 'utf8')).toBe('winner');
  });

  test('without hard links a failed rename removes the empty claim and rethrows', () => {
    const target = path.join(tmp, 'target');
    jest.spyOn(fs, 'linkSync').mockImplementation(() => { throw fail('ENOSYS'); });
    const rename = () => { throw fail('EACCES'); };
    expect(() => publishExclusive(stage('x'), target, { rename })).toThrow('EACCES');
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('the publish paths retry a Windows rename', () => {
  afterEach(() => jest.restoreAllMocks());
  const asWin32 = <T>(fn: () => T): T => asPlatform('win32', fn);
  /** Make the first rename fail with EPERM. Later renames run for real. */
  const failFirstRename = () => {
    const real = fs.renameSync.bind(fs);
    let n = 0;
    return jest.spyOn(fs, 'renameSync').mockImplementation((a, b) => { if (n++ === 0) throw fail('EPERM'); real(a, b); });
  };

  test('writePrivateFile survives one EPERM on win32', () => {
    const spy = failFirstRename();
    const target = path.join(tmp, 'out.txt');
    asWin32(() => writePrivateFile(target, 'data'));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(target, 'utf8')).toBe('data');
    expect(fs.readdirSync(tmp)).toEqual(['out.txt']);
  });

  test('writeExportFile with force survives one EPERM on win32', () => {
    const spy = failFirstRename();
    const target = path.join(tmp, 'out.txt');
    fs.writeFileSync(target, 'old');
    asWin32(() => writeExportFile(target, 'new', true));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
  });

  test('writeExportFile without force and without hard links survives one EPERM on win32', () => {
    jest.spyOn(fs, 'linkSync').mockImplementation(() => { throw fail('ENOSYS'); });
    const spy = failFirstRename();
    const target = path.join(tmp, 'out.txt');
    asWin32(() => writeExportFile(target, 'new', false));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
  });

  test('on linux the first EPERM is final', () => {
    const spy = failFirstRename();
    expect(() => asPlatform('linux', () => writePrivateFile(path.join(tmp, 'out.txt'), 'data'))).toThrow('EPERM');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});
