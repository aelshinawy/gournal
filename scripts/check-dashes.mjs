// Fails when the em dash character (U+2014) appears in the checked paths.
// Usage: node scripts/check-dashes.mjs [path ...]
// Default paths: site/src and README.md. Skips node_modules and dist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EM_DASH = String.fromCharCode(0x2014);
const SKIP = new Set(['node_modules', 'dist']);

const args = process.argv.slice(2);
const roots = args.length > 0 ? args : [path.join(repoRoot, 'site/src'), path.join(repoRoot, 'README.md')];

function* walk(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    yield target;
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    yield* walk(path.join(target, entry.name));
  }
}

let found = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EM_DASH)) {
        console.error(`${path.relative(process.cwd(), file)}:${i + 1}: em dash found`);
        found++;
      }
    });
  }
}

if (found > 0) {
  console.error(`check-dashes: ${found} line(s) with an em dash.`);
  process.exit(1);
}
console.log('check-dashes: ok');
