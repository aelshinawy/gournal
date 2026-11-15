import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export class LockTimeoutError extends Error {
  readonly lockPath: string;

  constructor(lockPath: string, timeoutMs: number) {
    super(
      `Journal is busy: could not get ${lockPath} within ${timeoutMs} ms. No entry was written.` +
        ` If no gournal process is running, remove ${lockPath}.`
    );
    this.name = 'LockTimeoutError';
    this.lockPath = lockPath;
  }
}

export type LockOptions = { staleMs?: number; timeoutMs?: number };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type Owner = { pid: number; hostname: string; token: string; acquiredAt: number };

function ownerFile(dirPath: string): string {
  return path.join(dirPath, 'owner.json');
}

// Returns null when owner.json is missing or not a valid owner record.
// With strict, any read error other than ENOENT is thrown, so release can tell
// "no owner" from "could not read".
async function readOwner(dirPath: string, strict = false): Promise<Owner | null> {
  let text: string;
  try {
    text = await fs.readFile(ownerFile(dirPath), 'utf8');
  } catch (err) {
    if (strict && (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return null;
  }
  try {
    const o = JSON.parse(text);
    if (typeof o?.pid === 'number' && typeof o.hostname === 'string' && typeof o.token === 'string' && typeof o.acquiredAt === 'number') {
      return o as Owner;
    }
  } catch {
    // Not valid JSON. The caller falls back to the folder age.
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

const BOOT_SLACK_MS = 5_000;

// Create a directory that has its owner.json from the moment it exists.
// The owner is written inside a private tmp dir. A rename then puts the dir in place.
// The rename fails when the target exists, because a real lock always holds owner.json.
// Returns the owner token, or null when the directory is already held.
async function createOwnedDir(dirPath: string): Promise<string | null> {
  const token = crypto.randomBytes(16).toString('hex');
  const tmp = `${dirPath}.${token}.tmp`;
  const owner: Owner = { pid: process.pid, hostname: os.hostname(), token, acquiredAt: Date.now() };
  await fs.mkdir(tmp);
  try {
    await fs.writeFile(ownerFile(tmp), JSON.stringify(owner));
    // A rename onto an empty dir succeeds on POSIX, so look first. Real locks are never empty.
    if (await fs.pathExists(dirPath)) {
      await fs.rm(tmp, { recursive: true, force: true });
      return null;
    }
    await fs.rename(tmp, dirPath);
    return token;
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return null;
    throw err;
  }
}

// Remove tmp dirs of crashed acquires: `<dirPath>.*.tmp` older than staleMs.
async function sweepTmpDirs(dirPath: string, staleMs: number): Promise<void> {
  try {
    const parent = path.dirname(dirPath);
    const prefix = `${path.basename(dirPath)}.`;
    for (const name of await fs.readdir(parent)) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
      const full = path.join(parent, name);
      try {
        if (Date.now() - (await fs.stat(full)).mtimeMs > staleMs) {
          await fs.rm(full, { recursive: true, force: true });
        }
      } catch {
        // Gone already, or not ours to remove. Ignore.
      }
    }
  } catch {
    // Best effort only.
  }
}

type Verdict = { stale: boolean | 'gone'; token: string | null };

// Staleness rules, used for the main lock and for `.break`. A lock is stale only when:
//  a. its owner is on this host and acquiredAt is before the last boot (minus slack), or
//  b. its owner is on this host and the owner pid is dead (ESRCH; EPERM means alive), or
//  c. its owner is on another host and acquiredAt is older than staleMs, or
//  d. there is no readable owner.json and the folder mtime is older than staleMs.
// A lock held by a live process on this host since this boot is never stale, whatever its age.
// The waiter then times out. That is a failure, not a lost entry.
async function judge(dirPath: string, staleMs: number): Promise<Verdict> {
  const owner = await readOwner(dirPath);
  if (owner) {
    if (owner.hostname === os.hostname()) {
      const bootTime = Date.now() - os.uptime() * 1000;
      return { stale: owner.acquiredAt < bootTime - BOOT_SLACK_MS || !isAlive(owner.pid), token: owner.token };
    }
    return { stale: Date.now() - owner.acquiredAt > staleMs, token: owner.token };
  }
  try {
    return { stale: Date.now() - (await fs.stat(dirPath)).mtimeMs > staleMs, token: null };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { stale: 'gone', token: null };
    throw err;
  }
}

// Break a stale lock only while holding the owned lock `<lockPath>.break`.
// Under it, judge again and delete only the lock whose token was judged stale,
// so a waiter never removes a lock that a new holder took in the meantime.
async function breakIfStale(lockPath: string, staleMs: number, judgedToken: string | null): Promise<boolean> {
  const breakPath = `${lockPath}.break`;
  const breakToken = await createOwnedDir(breakPath);
  if (breakToken === null) {
    // Someone else holds .break. Remove it only if that holder is stale by the same rules.
    const verdict = await judge(breakPath, staleMs);
    if (verdict.stale === true) await release(breakPath, verdict.token);
    return false;
  }
  try {
    const now = await judge(lockPath, staleMs);
    if (now.stale !== true || now.token !== judgedToken) return false;
    await fs.rm(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    await release(breakPath, breakToken);
  }
}

async function acquire(lockPath: string, staleMs: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const token = await createOwnedDir(lockPath);
    if (token !== null) {
      await sweepTmpDirs(lockPath, staleMs);
      return token;
    }
    const verdict = await judge(lockPath, staleMs);
    if (verdict.stale === 'gone') continue;
    if (verdict.stale && (await breakIfStale(lockPath, staleMs, verdict.token))) continue;
    if (Date.now() >= deadline) throw new LockTimeoutError(lockPath, timeoutMs);
    await sleep(20 + Math.floor(Math.random() * 41));
  }
}

// Remove the dir only when its owner token matches. token null means a dir without an owner:
// nothing to match, so it is removed only by the caller that judged it stale.
async function release(dirPath: string, token: string | null): Promise<void> {
  let owner: Owner | null;
  try {
    owner = await readOwner(dirPath, true);
  } catch {
    await sleep(10);
    try {
      owner = await readOwner(dirPath, true);
    } catch {
      process.stderr.write(`gournal: could not verify lock owner at ${dirPath}; leaving it in place\n`);
      return;
    }
  }
  if (token === null ? owner === null : owner?.token === token) {
    await fs.rm(dirPath, { recursive: true, force: true });
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
