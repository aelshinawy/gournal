import path from 'path';
import { spawnSync } from 'child_process';
import { FRAME_MS, startSpinner, withSpinner } from '../../src/adapters/cli/spinner';

const root = path.resolve(__dirname, '../..');
const TTY_ENV = { TERM: 'xterm-256color' };
const CLEAR = '\r         \r';

function fake(isTTY: boolean): { isTTY: boolean; chunks: string[]; write(chunk: string): boolean } {
  const chunks: string[] = [];
  return {
    isTTY,
    chunks,
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a stream that is not a terminal gets no bytes', () => {
  const s = fake(false);
  const spinner = startSpinner('Working', s, TTY_ENV);
  jest.advanceTimersByTime(FRAME_MS * 10);
  spinner.stop();
  expect(s.chunks).toEqual([]);
});

test.each([[{ TERM: 'dumb' }], [{ TERM: 'xterm', CI: 'true' }]])('env %j gets no bytes on a terminal', (env) => {
  const s = fake(true);
  const spinner = startSpinner('Working', s, env);
  jest.advanceTimersByTime(FRAME_MS * 10);
  spinner.stop();
  expect(s.chunks).toEqual([]);
});

test('a terminal gets frames, then a cleared line', () => {
  const s = fake(true);
  const spinner = startSpinner('Working', s, TTY_ENV);
  jest.advanceTimersByTime(FRAME_MS * 5);
  spinner.stop();
  expect(s.chunks).toEqual(['\r| Working', '\r/ Working', '\r- Working', '\r\\ Working', '\r| Working', CLEAR]);
});

test('a stop before the first frame writes nothing', () => {
  const s = fake(true);
  const spinner = startSpinner('Working', s, TTY_ENV);
  jest.advanceTimersByTime(FRAME_MS - 1);
  spinner.stop();
  expect(s.chunks).toEqual([]);
});

test('stop clears the timer and a second stop writes nothing', () => {
  const s = fake(true);
  const spinner = startSpinner('Working', s, TTY_ENV);
  jest.advanceTimersByTime(FRAME_MS);
  expect(jest.getTimerCount()).toBe(1);
  spinner.stop();
  spinner.stop();
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(FRAME_MS * 5);
  expect(s.chunks).toEqual(['\r| Working', CLEAR]);
});

test('the timer does not keep the process alive', () => {
  jest.useRealTimers();
  const spy = jest.spyOn(global, 'setInterval');
  const spinner = startSpinner('Working', fake(true), TTY_ENV);
  try {
    expect((spy.mock.results[0]?.value as NodeJS.Timeout).hasRef()).toBe(false);
  } finally {
    spinner.stop();
    spy.mockRestore();
  }
});

test('withSpinner clears the line before a rejection reaches the caller', async () => {
  jest.useRealTimers();
  const saved = { CI: process.env.CI, TERM: process.env.TERM };
  delete process.env.CI;
  process.env.TERM = 'xterm';
  try {
    const s = fake(true);
    await expect(
      withSpinner('Working', () => new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), FRAME_MS * 3)), s)
    ).rejects.toThrow('boom');
    expect(s.chunks.length).toBeGreaterThan(1);
    expect(s.chunks[s.chunks.length - 1]).toBe(CLEAR);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a piped stderr in a real process gets no bytes', () => {
  jest.useRealTimers();
  const script = `
    const { withSpinner, FRAME_MS } = require('./src/adapters/cli/spinner');
    withSpinner('Working', () => new Promise((r) => setTimeout(r, FRAME_MS * 4)));
  `;
  const r = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TERM: 'xterm', CI: '' },
  });
  expect(r.status).toBe(0);
  expect(r.stderr).toBe('');
});
