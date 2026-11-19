import fs from 'fs';
import path from 'path';
import { makeTmp } from './tmp';

let cached: boolean | undefined;

/**
 * True when this process can create a symbolic link.
 * Windows needs a privilege or Developer Mode for it. The probe runs once.
 */
export function canSymlink(): boolean {
  if (cached !== undefined) return cached;
  const dir = makeTmp('gournal-symlink-probe-');
  try {
    const target = path.join(dir, 'target');
    fs.writeFileSync(target, '');
    fs.symlinkSync(target, path.join(dir, 'link'));
    cached = true;
  } catch {
    cached = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return cached;
}
