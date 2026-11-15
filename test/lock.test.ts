import fs from 'fs';
import os from 'os';
import path from 'path';
import { withLock, LockTimeoutError } from '../src/lock';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('withLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-'));
    lockPath = path.join(dir, 'entries.json.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('runs fn and releases the lock', async () => {
    expect(await withLock(lockPath, async () => 42)).toBe(42);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
  test('releases the lock when fn throws', async () => {
    await expect(withLock(lockPath, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
  test('serializes overlapping callers', async () => {
    const order: string[] = [];
    const slow = withLock(lockPath, async () => { order.push('a-start'); await sleep(100); order.push('a-end'); });
    await sleep(10);
    const fast = withLock(lockPath, async () => { order.push('b'); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });
  test('breaks a stale lock', async () => {
    fs.mkdirSync(lockPath);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old);
    expect(await withLock(lockPath, async () => 'ok', { staleMs: 10_000, timeoutMs: 1_000 })).toBe('ok');
  });
  test('times out on a held lock', async () => {
    fs.mkdirSync(lockPath);
    await expect(withLock(lockPath, async () => 'never', { staleMs: 60_000, timeoutMs: 300 }))
      .rejects.toBeInstanceOf(LockTimeoutError);
    expect(fs.existsSync(lockPath)).toBe(true);
  });
});
