import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { withLock, LockTimeoutError } from '../src/lock';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function deadOwner() {
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise(resolve => child.on('exit', resolve));
  return { pid: child.pid, hostname: os.hostname(), token: 'dead', acquiredAt: Date.now() };
}

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
  test('timeout error names the lock path', async () => {
    fs.mkdirSync(lockPath);
    const err = await withLock(lockPath, async () => 'never', { staleMs: 60_000, timeoutMs: 100 }).catch(e => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect(err.lockPath).toBe(lockPath);
  });
  test('does not break a lock owned by a live process', async () => {
    const owner = JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: 'x', acquiredAt: Date.now() - 60_000 });
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'), owner);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old);
    await expect(withLock(lockPath, async () => 'never', { staleMs: 1_000, timeoutMs: 300 }))
      .rejects.toBeInstanceOf(LockTimeoutError);
    expect(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).toBe(owner);
  });
  test('breaks a lock owned by a dead process', async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(await deadOwner()));
    expect(await withLock(lockPath, async () => 'ok', { staleMs: 60_000, timeoutMs: 1_000 })).toBe('ok');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
  test('release does not remove a lock it no longer owns', async () => {
    await withLock(lockPath, async () => {
      const ownerFile = path.join(lockPath, 'owner.json');
      const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
      fs.writeFileSync(ownerFile, JSON.stringify({ ...owner, token: 'someone-else' }));
    });
    expect(fs.existsSync(lockPath)).toBe(true);
  });
  test('only one waiter breaks a stale lock', async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(await deadOwner()));
    let inside = 0;
    let maxInside = 0;
    let done = 0;
    await Promise.all(Array.from({ length: 6 }, () => withLock(lockPath, async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await sleep(20);
      inside--;
      done++;
    })));
    expect(maxInside).toBe(1);
    expect(done).toBe(6);
  });
});
