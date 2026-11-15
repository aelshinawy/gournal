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
    expect(err.message.endsWith(` If no gournal process is running, remove ${lockPath}.`)).toBe(true);
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
  test('breaks a lock taken before the last boot', async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: 'x', acquiredAt: 0 }));
    expect(await withLock(lockPath, async () => 'ok', { staleMs: 60_000, timeoutMs: 1_000 })).toBe('ok');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
  test('breaks a lock owned by another host after staleMs', async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, hostname: 'other-host', token: 'x', acquiredAt: Date.now() - 60_000 }));
    expect(await withLock(lockPath, async () => 'ok', { staleMs: 10_000, timeoutMs: 1_000 })).toBe('ok');
  });
  test('does not break a fresh lock owned by another host', async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, hostname: 'other-host', token: 'x', acquiredAt: Date.now() }));
    await expect(withLock(lockPath, async () => 'never', { staleMs: 60_000, timeoutMs: 200 }))
      .rejects.toBeInstanceOf(LockTimeoutError);
  });
  test('a lock folder always has an owner and leaves no tmp dirs', async () => {
    await withLock(lockPath, async () => {
      expect(fs.existsSync(path.join(lockPath, 'owner.json'))).toBe(true);
    });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  test('removes old tmp dirs left by crashed acquires, keeps fresh ones', async () => {
    const oldTmp = `${lockPath}.aaa.tmp`;
    const freshTmp = `${lockPath}.bbb.tmp`;
    fs.mkdirSync(oldTmp);
    fs.mkdirSync(freshTmp);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(oldTmp, old, old);
    await withLock(lockPath, async () => undefined, { staleMs: 10_000, timeoutMs: 1_000 });
    expect(fs.existsSync(oldTmp)).toBe(false);
    expect(fs.existsSync(freshTmp)).toBe(true);
  });
  test('a live holder on .break blocks breaking and is not removed', async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(await deadOwner()));
    const breakPath = `${lockPath}.break`;
    fs.mkdirSync(breakPath);
    const breakOwner = JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: 'b', acquiredAt: Date.now() });
    fs.writeFileSync(path.join(breakPath, 'owner.json'), breakOwner);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(breakPath, old, old); // old mtime must not matter: the owner is alive
    await expect(withLock(lockPath, async () => 'never', { staleMs: 1_000, timeoutMs: 300 }))
      .rejects.toBeInstanceOf(LockTimeoutError);
    expect(fs.readFileSync(path.join(breakPath, 'owner.json'), 'utf8')).toBe(breakOwner);
  });
  test('breaks a .break lock whose owner is dead', async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(await deadOwner()));
    const breakPath = `${lockPath}.break`;
    fs.mkdirSync(breakPath);
    fs.writeFileSync(path.join(breakPath, 'owner.json'), JSON.stringify(await deadOwner()));
    expect(await withLock(lockPath, async () => 'ok', { staleMs: 60_000, timeoutMs: 2_000 })).toBe('ok');
  });
  test('release leaves a note on stderr when the owner cannot be read', async () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await withLock(lockPath, async () => {
        const ownerFile = path.join(lockPath, 'owner.json');
        fs.rmSync(ownerFile);
        fs.mkdirSync(ownerFile); // reading a directory gives EISDIR, not ENOENT
      });
      const written = spy.mock.calls.map(c => String(c[0])).join('');
      expect(written).toContain(`gournal: could not verify lock owner at ${lockPath}; leaving it in place`);
      expect(fs.existsSync(lockPath)).toBe(true);
    } finally {
      spy.mockRestore();
    }
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
