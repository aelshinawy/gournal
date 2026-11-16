import fs from 'fs';

/**
 * Delete a temporary directory.
 * Windows can hold a SQLite file for a short time after close. The retries wait for it.
 */
export function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
