import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../../src/storage/config';
import { gournalHome } from '../../src/storage/home';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-cfg-')); });
afterEach(() => { delete process.env.GOURNAL_HOME; fs.rmSync(dir, { recursive: true, force: true }); });

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
  expect(gournalHome()).toBe(path.join(process.env.HOME || process.env.USERPROFILE || '', '.gournal'));
});
