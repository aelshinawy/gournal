import os from 'os';
import path from 'path';
import { gournalHome } from '../src/storage/home';

describe('test isolation', () => {
  const realHome = process.env.GOURNAL_REAL_HOME as string;

  test('gournalHome is not under the real home', () => {
    expect(realHome).toBeTruthy();
    expect(gournalHome().startsWith(path.join(realHome, '.gournal'))).toBe(false);
    expect(gournalHome()).toBe(process.env.GOURNAL_HOME);
  });

  test('os.homedir is the temp dir', () => {
    expect(os.homedir()).toBe(process.env.HOME);
    expect(os.homedir()).not.toBe(realHome);
  });

  test('the guard refuses the real gournal home', () => {
    const saved = process.env.GOURNAL_HOME;
    process.env.GOURNAL_HOME = path.join(realHome, '.gournal');
    try {
      expect(() => gournalHome()).toThrow('refusing to use the real gournal home under test');
    } finally {
      process.env.GOURNAL_HOME = saved;
    }
  });

  test('the guard also catches a default home that resolves to the real one', () => {
    const saved = { g: process.env.GOURNAL_HOME, h: process.env.HOME, u: process.env.USERPROFILE };
    delete process.env.GOURNAL_HOME;
    process.env.HOME = realHome;
    process.env.USERPROFILE = realHome; // Windows ignores HOME
    try {
      expect(() => gournalHome()).toThrow('refusing to use the real gournal home under test');
    } finally {
      process.env.GOURNAL_HOME = saved.g;
      process.env.HOME = saved.h;
      process.env.USERPROFILE = saved.u;
    }
  });
});
