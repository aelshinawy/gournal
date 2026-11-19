import fs from 'fs';
import path from 'path';

export const ROOT = path.resolve(__dirname, '..', '..');

/** Every .ts file under dir (relative to the repo root), as repo-relative paths with forward slashes. */
export function tsFiles(dir: string, skip: string[] = []): string[] {
  const walk = (abs: string): string[] => fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(abs, e.name);
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) return [];
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') ? [rel] : [];
  });
  return walk(path.join(ROOT, dir)).sort();
}

/** Line count as wc -l gives it: the number of newline characters. */
export function lineCount(rel: string): number {
  return (fs.readFileSync(path.join(ROOT, rel), 'utf8').match(/\n/g) ?? []).length;
}
