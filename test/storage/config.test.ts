import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../../src/storage/config';
import { gournalHome } from '../../src/storage/home';

let dir: string;
const savedHome = process.env.GOURNAL_HOME;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-cfg-')); });
afterEach(() => {
  if (savedHome === undefined) delete process.env.GOURNAL_HOME; else process.env.GOURNAL_HOME = savedHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadConfig creates a stable deviceId', () => {
  const a = loadConfig(dir); const b = loadConfig(dir);
  expect(a.deviceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(b).toEqual(a);
  expect(a).toEqual({ deviceId: a.deviceId, projectAliases: {}, tagAliases: {}, ticketPrefixes: [] });
});
test('loadConfig fills missing keys and keeps existing values', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ deviceId: 'D1', tagAliases: { a: 'b' } }));
  expect(loadConfig(dir)).toEqual({ deviceId: 'D1', projectAliases: {}, tagAliases: { a: 'b' }, ticketPrefixes: [] });
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
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
