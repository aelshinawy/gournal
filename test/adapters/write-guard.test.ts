import fs from 'fs';
import path from 'path';

const ADAPTERS = path.join(__dirname, '..', '..', 'src', 'adapters');
const WRITER = path.join(ADAPTERS, 'entry-writer.ts');
const WRITE_CALL = /\brepo\??\.\s*(add|update|resolve|softDelete|softDeleteAll|restore)\s*\(/g;

const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : e.name.endsWith('.ts') ? [p] : [];
});
const calls = (file: string): string[] => [...fs.readFileSync(file, 'utf8').matchAll(WRITE_CALL)].map((m) => m[1]);

test('only the Entry writer calls an entry repository write method', () => {
  const all = files(ADAPTERS);
  expect(all.length).toBeGreaterThan(5);
  const offenders = all.filter((f) => f !== WRITER && calls(f).length > 0).map((f) => path.relative(ADAPTERS, f));
  expect(offenders).toEqual([]);
});

test('the scan sees every write method in the Entry writer', () => {
  expect(new Set(calls(WRITER))).toEqual(new Set(['add', 'update', 'resolve', 'softDelete', 'softDeleteAll', 'restore']));
});
