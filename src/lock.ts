import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export class LockTimeoutError extends Error {
  readonly lockPath: string;

  constructor(lockPath: string, timeoutMs: number) {
    super(`Journal is busy: could not get ${lockPath} within ${timeoutMs} ms. No entry was written.`);
    this.name = 'LockTimeoutError';
    this.lockPath = lockPath;
  }
}

export type LockOptions = { staleMs?: number; timeoutMs?: number };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Owner = { pid: number; hostname: string; token: string; acquiredAt: number };

function ownerFile(lockPath: string): string {
  return path.join(lockPath, 'owner.json');
}

async function readOwner(lockPath: string): Promise<Owner | null> {
  try {
    const o = JSON.parse(await fs.readFile(ownerFile(lockPath), 'utf8'));
    if (typeof o?.pid === 'number' && typeof o.hostname === 'string' && typeof o.token === 'string' && typeof o.acquiredAt === 'number') {
      return o as Owner;
    }
  } catch {
    // Missing or unreadable owner file. The caller falls back to the folder age.
  }
  return null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

// Staleness rules. A lock is stale only when:
//  a. its owner is on this host and the owner pid is dead (ESRCH; EPERM means alive), or
//  b. its owner is on another host and acquiredAt is older than staleMs, or
//  c. owner.json is missing or unreadable and the folder mtime is older than staleMs
//     (a crash between mkdir and the owner write).
// A lock held by a live process on this host is never stale, whatever its age.
// The waiter then times out. That is a failure, not a lost entry.
async function isStale(lockPath: string, staleMs: number): Promise<'gone' | boolean> {
  const owner = await readOwner(lockPath);
  if (owner) {
    if (owner.hostname === os.hostname()) return !isAlive(owner.pid);
    return Date.now() - owner.acquiredAt > staleMs;
  }
  try {
    return Date.now() - (await fs.stat(lockPath)).mtimeMs > staleMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'gone';
    throw err;
  }
}

// Break a stale lock only while holding the secondary lock `<lockPath>.break`.
// Under it, check staleness again, so two waiters never remove a fresh lock.
async function breakIfStale(lockPath: string, staleMs: number): Promise<boolean> {
  const breakPath = `${lockPath}.break`;
  try {
    await fs.mkdir(breakPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    try {
      if (Date.now() - (await fs.stat(breakPath)).mtimeMs > staleMs) {
        await fs.rm(breakPath, { recursive: true, force: true });
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return false;
  }
  try {
    if ((await isStale(lockPath, staleMs)) !== true) return false;
    await fs.rm(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    await fs.rm(breakPath, { recursive: true, force: true });
  }
}

async function acquire(lockPath: string, staleMs: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fs.mkdir(lockPath);
      const owner: Owner = {
        pid: process.pid,
        hostname: os.hostname(),
        token: crypto.randomBytes(16).toString('hex'),
        acquiredAt: Date.now(),
      };
      try {
        await fs.writeFile(ownerFile(lockPath), JSON.stringify(owner));
      } catch (err) {
        await fs.rm(lockPath, { recursive: true, force: true });
        throw err;
      }
      return owner.token;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const stale = await isStale(lockPath, staleMs);
    if (stale === 'gone') continue;
    if (stale && (await breakIfStale(lockPath, staleMs))) continue;
    if (Date.now() >= deadline) throw new LockTimeoutError(lockPath, timeoutMs);
    await sleep(20 + Math.floor(Math.random() * 41));
  }
}

async function release(lockPath: string, token: string): Promise<void> {
  const owner = await readOwner(lockPath);
  if (owner && owner.token === token) {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

export async function withLock<T>(lockPath: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const { staleMs = 10_000, timeoutMs = 10_000 } = opts;
  const token = await acquire(lockPath, staleMs, timeoutMs);
  try {
    return await fn();
  } finally {
    await release(lockPath, token);
  }
}
