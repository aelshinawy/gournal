import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

/** The installed package folder. Node resolves __dirname to a real path, so this never holds a symlink. */
export const PACKAGE_ROOT: string = path.resolve(__dirname, '..', '..', '..');

interface Placement { rel: string; real: string; name: string; version: string }
interface Manifest { version?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }

function readManifest(dir: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest;
}

function assertBuilt(root: string): void {
  if (!fs.existsSync(path.join(root, 'dist', 'cli.js'))) {
    throw new Error(`cannot copy gournal from ${root}: no dist/cli.js. Run npm run build.`);
  }
}

/** The first node_modules/<name> that Node would search from realDir upward, or null. */
function findDependency(realDir: string, name: string): string | null {
  const searched = createRequire(path.join(realDir, 'x.js')).resolve.paths(name) ?? [];
  for (const dir of searched) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/** Decide where each production dependency goes. The first version of a name takes the hoisted slot. A different version nests. */
function planDependencies(root: string): Placement[] {
  const hoisted = new Map<string, string>(); // slot -> real path
  const placed = new Map<string, string>(); // every placed rel path -> real path
  const out: Placement[] = [];
  const visit = (realDir: string, destRel: string): void => {
    const manifest = readManifest(realDir);
    const names = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]);
    const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
    for (const name of names) {
      const found = findDependency(realDir, name);
      if (!found) {
        if (optional.has(name)) continue;
        throw new Error(`cannot copy gournal: dependency ${name} not found from ${realDir}`);
      }
      const real = fs.realpathSync(found);
      const slot = path.join('node_modules', name);
      let rel = slot;
      if (!hoisted.has(slot)) hoisted.set(slot, real);
      else if (hoisted.get(slot) !== real) rel = path.join(destRel, 'node_modules', name);
      if (placed.get(rel) === real) continue;
      placed.set(rel, real);
      out.push({ rel, real, name, version: readManifest(real).version ?? '0.0.0' });
      visit(real, rel);
    }
  };
  visit(fs.realpathSync(root), '');
  return out;
}

function listFiles(dir: string, base: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => path.relative(base, path.join(entry.parentPath, entry.name)));
}

/** 12 hex characters over package.json, every file under dist, and name@version of each dependency. */
export function packageFingerprint(root: string): string {
  assertBuilt(root);
  const hash = crypto.createHash('sha256');
  const files = ['package.json', ...listFiles(path.join(root, 'dist'), root)].map((f) => f.split(path.sep).join('/')).sort();
  for (const file of files) {
    hash.update(`file ${file}\0`);
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  const deps = planDependencies(root).map((p) => `${p.rel.split(path.sep).join('/')}=${p.name}@${p.version}`).sort();
  for (const dep of deps) hash.update(`dep ${dep}\0`);
  return hash.digest('hex').slice(0, 12);
}

/** Copy package.json, dist, and the production dependency closure. Symlinks are followed. */
export function copyPackage(root: string, dest: string): void {
  assertBuilt(root);
  const plan = planDependencies(root);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(dest, 'package.json'));
  fs.cpSync(path.join(root, 'dist'), path.join(dest, 'dist'), { recursive: true, dereference: true });
  for (const { rel, real } of plan) {
    fs.cpSync(real, path.join(dest, rel), {
      recursive: true,
      dereference: true,
      filter: (src) => path.relative(real, src).split(path.sep)[0] !== 'node_modules',
    });
  }
}
