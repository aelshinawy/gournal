import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('gournal undo', () => {
  let home: string;

  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', 'src/cli.ts', ...args],
      { cwd: path.join(__dirname, '..'), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' }
    );

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-'));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('removes the last entry it reports, one at a time', () => {
    expect(run('add', 'first').status).toBe(0);
    expect(run('add', 'second').status).toBe(0);

    const undo1 = run('undo');
    expect(undo1.status).toBe(0);
    expect(undo1.stdout).toContain('Removed: second');
    const entries = JSON.parse(fs.readFileSync(path.join(home, '.gournal', 'entries.json'), 'utf8'));
    expect(entries.map((e: { message: string }) => e.message)).toEqual(['first']);

    expect(run('undo').stdout).toContain('Removed: first');
    expect(run('undo').stdout).toContain('No entries to undo.');
  });
});
