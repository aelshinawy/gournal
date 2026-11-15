import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildProgram } from '../../../src/adapters/cli';
import { cliPages, type GeneratedPage } from './cli';
import { configPage, environmentPage } from './config';
import { mcpPages } from './mcp';

export type { GeneratedPage };

export const REFERENCE_DIR = 'src/content/docs/docs/reference';

/**
 * Paths the generator owns, relative to the reference folder. It deletes any other file in a
 * directory entry.
 */
export const OWNED: ReadonlyArray<{ dir: string } | { file: string }> = [
  { dir: 'cli' },
  { dir: 'mcp' },
  { file: 'configuration.md' },
  { file: 'environment.md' },
];

/** A program build must not open the journal. These no-op seams keep it inert. */
export function inertProgram() {
  return buildProgram({
    out: () => undefined,
    err: () => undefined,
    cwd: os.tmpdir(),
    home: path.join(os.tmpdir(), 'gournal-docs-never-opened'),
    isTTY: false,
  });
}

function sortedFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...sortedFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function readExamples(examplesDir: string, sub: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of sortedFiles(path.join(examplesDir, sub))) {
    if (!file.endsWith('.md')) continue;
    map.set(file.slice(0, -3), fs.readFileSync(path.join(examplesDir, sub, file), 'utf8'));
  }
  return map;
}

export async function generateReference(opts: { examplesDir: string }): Promise<GeneratedPage[]> {
  const pages = [
    ...cliPages(inertProgram(), readExamples(opts.examplesDir, 'cli')),
    ...(await mcpPages(readExamples(opts.examplesDir, 'mcp'))),
    configPage(),
    environmentPage(),
  ];
  return pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Files that exist in an owned path of the reference folder, relative to it, sorted. */
export function ownedFilesOnDisk(referenceDir: string): string[] {
  const out: string[] = [];
  for (const entry of OWNED) {
    if ('dir' in entry) out.push(...sortedFiles(path.join(referenceDir, entry.dir), entry.dir));
    else if (fs.existsSync(path.join(referenceDir, entry.file))) out.push(entry.file);
  }
  return out.sort();
}

export async function writeReference(siteRoot: string): Promise<{ written: string[]; deleted: string[] }> {
  const referenceDir = path.join(siteRoot, REFERENCE_DIR);
  const pages = await generateReference({ examplesDir: path.join(siteRoot, 'src/content/examples') });
  const keep = new Set(pages.map((p) => p.path));
  const deleted: string[] = [];
  for (const rel of ownedFilesOnDisk(referenceDir)) {
    if (keep.has(rel)) continue;
    fs.rmSync(path.join(referenceDir, rel));
    deleted.push(rel);
  }
  const written: string[] = [];
  for (const p of pages) {
    const target = path.join(referenceDir, p.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, p.content);
    written.push(p.path);
  }
  return { written, deleted };
}

/** Example files that have no generated page. Paths are relative to the examples folder, such as `cli/nope.md`. */
export function orphanExamples(pages: GeneratedPage[], examplesDir: string): string[] {
  const have = new Set(pages.map((p) => p.path));
  const orphans: string[] = [];
  for (const sub of ['cli', 'mcp']) {
    for (const slug of readExamples(examplesDir, sub).keys()) {
      if (!have.has(`${sub}/${slug}.md`)) orphans.push(`${sub}/${slug}.md`);
    }
  }
  return orphans.sort();
}
