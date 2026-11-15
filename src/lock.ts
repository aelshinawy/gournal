import fs from 'fs-extra';

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

async function acquire(lockPath: string, staleMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fs.mkdir(lockPath);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    try {
      const stat = await fs.stat(lockPath);
      if (Date.now() - stat.mtimeMs > staleMs) {
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }
    } catch (err) {
      // The holder released the lock between mkdir and stat. Retry at once.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    if (Date.now() >= deadline) throw new LockTimeoutError(lockPath, timeoutMs);
    await sleep(20 + Math.floor(Math.random() * 41));
  }
}

export async function withLock<T>(lockPath: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const { staleMs = 10_000, timeoutMs = 10_000 } = opts;
  await acquire(lockPath, staleMs, timeoutMs);
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}
