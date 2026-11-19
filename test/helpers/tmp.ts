import fs from 'fs';
import os from 'os';
import path from 'path';

/** Make a new empty folder under the OS temp folder. The name starts with prefix. */
export function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Make a new empty temp folder and return its real path (no symlink in it, for example /private/var on macOS). */
export function makeRealTmp(prefix: string): string {
  return fs.realpathSync(makeTmp(prefix));
}

/**
 * Delete a temporary directory.
 * Windows can hold a SQLite file for a short time after close. The retries wait for it.
 */
export function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
