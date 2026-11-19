import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { forceColor } from '../src/render/style';
import { runCli } from '../src/adapters/cli/program';
import { runIn } from './helpers/run-cli';
import { openDb } from '../src/storage/db';
import { loadConfig } from '../src/storage/config';
import { createRepository } from '../src/storage/sqlite-repository';
import { makeTmp, rmTmp } from './helpers/tmp';

const root = path.join(__dirname, '..');
let home: string;
beforeEach(() => { home = makeTmp('gournal-smoke-'); });
afterEach(() => rmTmp(home));

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
  test('runIn output has no ANSI even when color is forced on', async () => {
    const prev = forceColor(true);
    try {
      const r = await runIn(home, ['add', 'colour check']);
      expect(r.stdout).toContain('Entry added!');
      expect(r.stdout).not.toMatch(/\u001b\[/);
      expect(forceColor(prev)).toBe(true);
    } finally {
      forceColor(prev);
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
  // Like `gournal export | head -1`: the reader closes the pipe after the first line.
  test('a closed stdout pipe exits 0 with no stack trace', async () => {
    const dbPath = path.join(home, 'gournal.db');
    const db = openDb(dbPath);
    const repo = createRepository(db, loadConfig(home), dbPath);
    for (let i = 0; i < 3000; i++) repo.add({ summary: `entry ${i} lorem ipsum dolor sit amet`, project: 'p', source: 'cli' });
    db.close();
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/cli.ts', 'export'], {
      cwd: root,
      env: { ...process.env, GOURNAL_HOME: home, HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { stderr += d; });
    child.stdout.once('data', () => child.stdout.destroy());
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(stderr).not.toMatch(/EPIPE|\n\s+at /);
    expect(code).toBe(0);
    // The seed of 3000 entries and a cold ts-node start are slow on a loaded Windows runner. The default 30 s is too short.
  }, 90_000);
  test('clear with piped stdin deletes nothing', () => {
    spawnCli(['add', 'keep me']);
    const r = spawnCli(['clear'], 'y\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Not a terminal; nothing cleared.');
  });
  test('hook stop reads real stdin, asks once, and never creates the database', () => {
    const file = path.join(home, 't.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } }) + '\n');
    const stdin = JSON.stringify({ session_id: 'smoke', transcript_path: file, stop_hook_active: false });
    const r = spawnCli(['hook', 'stop'], stdin);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).decision).toBe('block');
    const again = spawnCli(['hook', 'stop'], stdin);
    expect(again.status).toBe(0);
    expect(again.stdout).toBe('');
    expect(fs.existsSync(path.join(home, 'gournal.db'))).toBe(false);
  });
});
