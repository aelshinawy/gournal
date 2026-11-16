import os from 'os';
import path from 'path';
import { defaultHomePath, gournalHome, isDefaultHome, userHomePath } from '../../src/storage/home';

const KEYS = ['HOME', 'USERPROFILE', 'GOURNAL_HOME', 'GOURNAL_REAL_HOME'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('home on Windows', () => {
  beforeEach(() => {
    delete process.env.GOURNAL_HOME;
    process.env.HOME = 'C:\\msys\\home\\x';
    process.env.USERPROFILE = 'C:\\Users\\x';
  });

  test('the default home uses USERPROFILE and ignores HOME', () => {
    expect(defaultHomePath('win32')).toBe('C:\\Users\\x\\.gournal');
  });

  test('without USERPROFILE the default home uses os.homedir()', () => {
    delete process.env.USERPROFILE;
    expect(defaultHomePath('win32')).toBe(path.win32.join(os.homedir(), '.gournal'));
  });

  test('on other systems HOME still wins', () => {
    expect(defaultHomePath('linux')).toBe(path.join('C:\\msys\\home\\x', '.gournal'));
    expect(defaultHomePath('darwin')).toBe(path.join('C:\\msys\\home\\x', '.gournal'));
  });

  test('gournalHome follows the same rule, and GOURNAL_HOME still wins', () => {
    expect(gournalHome('win32')).toBe('C:\\Users\\x\\.gournal');
    process.env.GOURNAL_HOME = 'D:\\journal';
    expect(gournalHome('win32')).toBe('D:\\journal');
  });

  test('isDefaultHome uses the same resolution and ignores case', () => {
    expect(isDefaultHome('C:\\Users\\x\\.gournal', 'win32')).toBe(true);
    expect(isDefaultHome('c:\\users\\X\\.GOURNAL\\', 'win32')).toBe(true);
    expect(isDefaultHome('C:\\msys\\home\\x\\.gournal', 'win32')).toBe(false);
    process.env.GOURNAL_HOME = 'C:\\Users\\x\\.gournal';
    expect(isDefaultHome('C:\\Users\\x\\.gournal', 'win32')).toBe(false);
  });

  test('isDefaultHome stays case-sensitive on other systems', () => {
    process.env.HOME = '/home/x';
    expect(isDefaultHome('/home/x/.gournal', 'linux')).toBe(true);
    expect(isDefaultHome('/home/X/.gournal', 'linux')).toBe(false);
  });

  test('the real-home guard compares case-insensitively on Windows', () => {
    process.env.GOURNAL_REAL_HOME = 'C:\\Users\\Real';
    process.env.GOURNAL_HOME = 'c:\\users\\real\\.GOURNAL';
    expect(() => gournalHome('win32')).toThrow('refusing to use the real gournal home under test');
  });

  test('the real-home guard catches a default home that resolves to the real one', () => {
    delete process.env.GOURNAL_HOME;
    process.env.GOURNAL_REAL_HOME = 'c:\\users\\X';
    expect(() => gournalHome('win32')).toThrow('refusing to use the real gournal home under test');
  });

  test('userHomePath is USERPROFILE on Windows and os.homedir() elsewhere', () => {
    expect(userHomePath('win32')).toBe('C:\\Users\\x');
    expect(userHomePath('linux')).toBe(os.homedir());
  });
});
