import fs from 'fs';
import os from 'os';
import path from 'path';
import { CONFIG_DEFAULTS } from '../../src/core';
import { loadConfig } from '../../src/storage/config';
import { gournalHome } from '../../src/storage/home';
import { rmTmp } from '../helpers/tmp';

let dir: string;
const savedHome = process.env.GOURNAL_HOME;
const savedNoAuto = process.env.GOURNAL_NO_AUTOSYNC;
beforeEach(() => { delete process.env.GOURNAL_NO_AUTOSYNC; dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-cfg-')); });
afterEach(() => {
  if (savedHome === undefined) delete process.env.GOURNAL_HOME; else process.env.GOURNAL_HOME = savedHome;
  if (savedNoAuto === undefined) delete process.env.GOURNAL_NO_AUTOSYNC; else process.env.GOURNAL_NO_AUTOSYNC = savedNoAuto;
  rmTmp(dir);
});

test('loadConfig creates a stable deviceId', () => {
  const a = loadConfig(dir); const b = loadConfig(dir);
  expect(a.deviceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(b).toEqual(a);
  expect(a).toEqual({ deviceId: a.deviceId, projectAliases: {}, tagAliases: {}, ticketPrefixes: [], ...CONFIG_DEFAULTS });
});
test('GOURNAL_NO_AUTOSYNC=1 turns github.autoSync off and leaves the file unchanged', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ deviceId: 'D1', github: { autoSync: true } }));
  loadConfig(dir); // the first load fills the missing keys
  const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  process.env.GOURNAL_NO_AUTOSYNC = '1';
  expect(loadConfig(dir).github.autoSync).toBe(false);
  expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).toBe(before);
});
test('another GOURNAL_NO_AUTOSYNC value keeps the configured github.autoSync', () => {
  process.env.GOURNAL_NO_AUTOSYNC = '0';
  expect(loadConfig(dir).github.autoSync).toBe(true);
  delete process.env.GOURNAL_NO_AUTOSYNC;
  expect(loadConfig(dir).github.autoSync).toBe(true);
});
test('loadConfig fills missing keys and keeps existing values', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ deviceId: 'D1', tagAliases: { a: 'b' } }));
  expect(loadConfig(dir)).toEqual({ deviceId: 'D1', projectAliases: {}, tagAliases: { a: 'b' }, ticketPrefixes: [], ...CONFIG_DEFAULTS });
});
test('loadConfig creates the folder and leaves no temp files', () => {
  const sub = path.join(dir, 'nested', 'home');
  loadConfig(sub);
  expect(fs.readdirSync(sub)).toEqual(['config.json']);
});
test('gournalHome honors GOURNAL_HOME', () => {
  process.env.GOURNAL_HOME = dir; expect(gournalHome()).toBe(dir);
});
test('gournalHome falls back to HOME/.gournal', () => {
  delete process.env.GOURNAL_HOME;
  expect(gournalHome()).toBe(path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.gournal'));
});
test('loadConfig persists filled keys and keeps the deviceId', () => {
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ deviceId: 'D1' }));
  loadConfig(dir);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ deviceId: 'D1', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] });
  expect(fs.readdirSync(dir)).toEqual(['config.json']);
});
test('a concurrent first run keeps the deviceId that won', () => {
  const file = path.join(dir, 'config.json');
  const winner = { deviceId: 'WINNER', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] };
  const c = loadConfig(dir, { beforePublish: () => fs.writeFileSync(file, JSON.stringify(winner)) });
  expect(c.deviceId).toBe('WINNER');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).deviceId).toBe('WINNER');
  expect(fs.readdirSync(dir)).toEqual(['config.json']);
});
test.each([
  ['invalid JSON', '{nope'],
  ['null', 'null'],
  ['an array', '[]'],
  ['a string', '"x"'],
  ['a number', '5'],
  ['non-string alias', JSON.stringify({ deviceId: 'D', tagAliases: { a: 1 } })],
  ['bad ticketPrefixes', JSON.stringify({ deviceId: 'D', ticketPrefixes: 'ABC' })],
  ['bad deviceId', JSON.stringify({ deviceId: 7 })],
])('loadConfig refuses %s and leaves the file unchanged', (_n, content) => {
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, content);
  expect(() => loadConfig(dir)).toThrow(new RegExp(`Config ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not valid JSON object: .*gournal did not change it\\.`));
  expect(fs.readFileSync(file, 'utf8')).toBe(content);
  expect(fs.readdirSync(dir)).toEqual(['config.json']);
});

test.each(['projectAliases', 'tagAliases'])('%s with an alias chain is rejected', (key) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-cfg-chain-'));
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ deviceId: 'D', [key]: { a: 'b', b: 'c' } }));
    expect(() => loadConfig(home)).toThrow('alias chain at "a"');
  } finally { rmTmp(home); }
});
test('new settings are not written to the file', () => {
  const file = path.join(dir, 'config.json');
  const text = JSON.stringify({ deviceId: 'D', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] }, null, 2) + '\n';
  fs.writeFileSync(file, text);
  expect(loadConfig(dir).staleAfterDays).toBe(14);
  expect(fs.readFileSync(file, 'utf8')).toBe(text);
});
test('a first-run file holds only the Phase 1 keys', () => {
  loadConfig(dir);
  expect(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))).sort())
    .toEqual(['deviceId', 'projectAliases', 'tagAliases', 'ticketPrefixes']);
});
test('loadConfig sends warnings to the warn hook', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ deviceId: 'D', projectAliases: {}, tagAliases: {}, ticketPrefixes: [], staleAfterDays: -1 }));
  const warn = jest.fn();
  expect(loadConfig(dir, { warn }).staleAfterDays).toBe(14);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('staleAfterDays must be a positive integer; using 14'));
});

describe('first run without hard links', () => {
  afterEach(() => jest.restoreAllMocks());
  const failLink = (code: string) =>
    jest.spyOn(fs, 'linkSync').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });

  test.each(['EPERM', 'ENOSYS', 'ENOTSUP', 'EXDEV', 'EINVAL'])('a link that fails with %s still publishes the config', (code) => {
    failLink(code);
    const c = loadConfig(dir);
    const file = path.join(dir, 'config.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).deviceId).toBe(c.deviceId);
    expect(loadConfig(dir)).toEqual(c);
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
  });

  test('the fallback keeps the deviceId of a process that won the race', () => {
    const file = path.join(dir, 'config.json');
    const winner = { deviceId: 'WINNER', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] };
    // The other process creates the file after our link fails and before our claim.
    jest.spyOn(fs, 'linkSync').mockImplementation(() => {
      fs.writeFileSync(file, JSON.stringify(winner));
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    expect(loadConfig(dir).deviceId).toBe('WINNER');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).deviceId).toBe('WINNER');
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
  });

  test('the fallback keeps the deviceId of a winner that is still renaming its file', () => {
    const file = path.join(dir, 'config.json');
    const winner = { deviceId: 'WINNER', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] };
    // The winner has claimed the file (empty) and has not renamed its finished file onto it yet.
    jest.spyOn(fs, 'linkSync').mockImplementation(() => {
      fs.writeFileSync(file, '');
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    const realStat = fs.statSync.bind(fs);
    let calls = 0;
    jest.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, o?: unknown) => {
      if (p === file && ++calls === 2) fs.writeFileSync(file, JSON.stringify(winner));
      return realStat(p, o as never);
    }) as typeof fs.statSync);
    expect(loadConfig(dir).deviceId).toBe('WINNER');
  });

  test('two loads in a row without hard links agree on one deviceId', () => {
    failLink('EPERM');
    const a = loadConfig(dir);
    const b = loadConfig(dir);
    expect(b.deviceId).toBe(a.deviceId);
  });
});

test('the config rewrite retries a Windows rename', () => {
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ deviceId: 'D1' }));
  const real = fs.renameSync.bind(fs);
  let n = 0;
  const spy = jest.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
    if (n++ === 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    real(a, b);
  });
  const saved = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { loadConfig(dir); } finally { Object.defineProperty(process, 'platform', saved); spy.mockRestore(); }
  expect(n).toBe(2);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).deviceId).toBe('D1');
  expect(fs.readdirSync(dir)).toEqual(['config.json']);
});

describe('an empty config file', () => {
  afterEach(() => jest.restoreAllMocks());
  const GOOD = { deviceId: 'D1', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] };
  /** A fake clock: sleep moves it forward, so that the tests do not wait. */
  const clock = (onSleep: (n: number) => void = () => undefined) => {
    let t = 0; let n = 0;
    return { now: () => t, sleep: (ms: number) => { t += ms; onSleep(++n); }, count: () => n };
  };

  test('an empty config that gets its content during the wait is read', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '');
    const c = clock((n) => { if (n === 3) fs.writeFileSync(file, JSON.stringify(GOOD)); });
    expect(loadConfig(dir, { sleep: c.sleep, now: c.now }).deviceId).toBe('D1');
    expect(c.count()).toBe(3);
  });

  test('an empty config that stays empty gives a plain message and is not changed', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '');
    const c = clock();
    expect(() => loadConfig(dir, { sleep: c.sleep, now: c.now })).toThrow(
      new Error(`Config ${file} is empty. An earlier first run was interrupted. Delete the file and run gournal again.`),
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('');
    // The wait lasts 500 ms, with a poll every 20 ms.
    expect(c.count()).toBe(25);
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
  });

  test('a non-empty file with invalid JSON keeps the old error and does not wait', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '{nope');
    const c = clock();
    expect(() => loadConfig(dir, { sleep: c.sleep, now: c.now })).toThrow(/is not valid JSON object: .*gournal did not change it\./);
    expect(c.count()).toBe(0);
  });

  const eperm = () => Object.assign(new Error('EPERM'), { code: 'EPERM' });

  test('a first run that finds the winner claim empty and stuck gives the same message', () => {
    const file = path.join(dir, 'config.json');
    jest.spyOn(fs, 'linkSync').mockImplementation(() => { fs.writeFileSync(file, ''); throw eperm(); });
    const c = clock();
    expect(() => loadConfig(dir, { sleep: c.sleep, now: c.now })).toThrow(`Config ${file} is empty. An earlier first run was interrupted.`);
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
  });

  test('a winner that removes its claim makes the loser publish once more', () => {
    const file = path.join(dir, 'config.json');
    let links = 0;
    // The first link call shows a claim from another process. That process fails its rename and removes the claim.
    jest.spyOn(fs, 'linkSync').mockImplementation(() => {
      if (links++ === 0) fs.writeFileSync(file, '');
      throw eperm();
    });
    const c = clock((n) => { if (n === 1) fs.rmSync(file); });
    const config = loadConfig(dir, { sleep: c.sleep, now: c.now });
    expect(links).toBe(2);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).deviceId).toBe(config.deviceId);
    expect(fs.readdirSync(dir)).toEqual(['config.json']);
  });
});

test('a first run without hard links never overwrites a winner that appears after the last existence check', () => {
  const file = path.join(dir, 'config.json');
  const winner = JSON.stringify({ deviceId: 'WINNER', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] });
  // The link fails with no side effect. The winner shows up just before the claim or before any rename onto the target.
  jest.spyOn(fs, 'linkSync').mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
  const realOpen = fs.openSync.bind(fs);
  const realRename = fs.renameSync.bind(fs);
  const plant = () => { if (!fs.existsSync(file)) fs.writeFileSync(file, winner); };
  jest.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
    if (p === file) plant();
    return (realOpen as (...a: unknown[]) => number)(p, ...rest);
  }) as typeof fs.openSync);
  jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === file) plant();
    realRename(from, to);
  });
  try {
    expect(loadConfig(dir).deviceId).toBe('WINNER');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).deviceId).toBe('WINNER');
  } finally {
    jest.restoreAllMocks();
  }
});
