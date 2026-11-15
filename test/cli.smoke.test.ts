import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { runCli } from '../src/adapters/cli/program';
import { runIn } from './helpers/run-cli';

const root = path.join(__dirname, '..');
let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-smoke-')); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const spawnCli = (args: string[], input = '') =>
  spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/cli.ts', ...args], {
    cwd: root,
    env: { ...process.env, GOURNAL_HOME: home, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    input,
  });

describe('in-process runner', () => {
  test('unknown kind exits 1 with the message on stderr', async () => {
    const r = await runIn(home, ['add', 'x', '-k', 'later']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown kind "later". Use done, blocker, or next.');
  });
  test('runCli does not call process.exit and does not set process.exitCode', async () => {
    const before = process.exitCode;
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await runCli(['node', 'gournal', '--version'], { home, out: () => {}, err: () => {} });
      await runCli(['node', 'gournal', 'nope'], { home, out: () => {}, err: () => {} });
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
    expect(process.exitCode).toBe(before);
  });
  test('runIn output has no ANSI even when chalk colour is on', async () => {
    const level = chalk.level;
    chalk.level = 3;
    try {
      const r = await runIn(home, ['add', 'colour check']);
      expect(r.stdout).toContain('Entry added!');
      expect(r.stdout).not.toMatch(/\u001b\[/);
      expect(chalk.level).toBe(3);
    } finally {
      chalk.level = level;
    }
  });
  test('version matches package.json', async () =>
    expect((await runIn(home, ['--version'])).stdout.trim()).toBe(require('../package.json').version));
  test('--help returns 0', async () => {
    const r = await runIn(home, ['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: gournal');
  });
  test('an unknown command returns 1', async () => {
    expect((await runIn(home, ['nope'])).status).toBe(1);
  });
});

describe('real process', () => {
  test('no SQLite experimental warning reaches stderr', () => {
    const r = spawnCli(['stats']);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('ExperimentalWarning');
    expect(r.stderr).not.toContain('SQLite is an experimental');
  });
  test('the bin shim adds an entry and exits 0', () => {
    const r = spawnCli(['add', 'from the bin']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/✓ Entry added! \([0-9A-Z]{8}\)/);
  });
  test('a failing command exits non-zero from a real process', () => {
    const r = spawnCli(['add', 'x', '-k', 'later']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown kind "later"');
  });
  test('clear with piped stdin deletes nothing', () => {
    spawnCli(['add', 'keep me']);
    const r = spawnCli(['clear'], 'y\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Not a terminal; nothing cleared.');
  });
});
