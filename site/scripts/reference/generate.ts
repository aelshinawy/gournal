import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildProgram } from '../../../src/adapters/cli';
import { CAPABILITIES, checkCoverage } from './capabilities';
import { capabilityPage, outputShapesPage, overviewPage } from './capability-page';
import { cliSection, leafCommands, type GeneratedPage } from './cli';
import { configPage, environmentPage } from './config';
import { listTools, sharedShapes, toolSection } from './mcp';

export type { GeneratedPage };

export const REFERENCE_DIR = 'src/content/docs/docs/reference';

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
  const program = inertProgram();
  const leaves = leafCommands(program);
  const tools = await listTools();
  const problems = checkCoverage(leaves.map((l) => l.names.join(' ')), tools.map((t) => t.name));
  if (problems.length > 0) throw new Error(problems.join('\n'));

  const cliExamples = readExamples(opts.examplesDir, 'cli');
  const mcpExamples = readExamples(opts.examplesDir, 'mcp');
  const { shapes, slugByTool } = sharedShapes(tools);
  const pages = CAPABILITIES.map((cap) => capabilityPage(
    cap,
    cap.cli.map((name) => {
      const leaf = leaves.find((l) => l.names.join(' ') === name)!;
      return cliSection(leaf.names, leaf.cmd, cliExamples.get(leaf.names.join('-')));
    }),
    cap.mcp.map((name) => {
      const tool = tools.find((t) => t.name === name)!;
      return toolSection(tool, slugByTool.get(name), mcpExamples.get(name));
    }),
  ));
  pages.push(overviewPage(), outputShapesPage(shapes), configPage(), environmentPage());
  return pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Remove empty folders below `dir`, so a removed section leaves no empty folder. */
function removeEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    removeEmptyDirs(child);
    if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
  }
}

export async function writeReference(siteRoot: string): Promise<{ written: string[]; deleted: string[] }> {
  const referenceDir = path.join(siteRoot, REFERENCE_DIR);
  const pages = await generateReference({ examplesDir: path.join(siteRoot, 'src/content/examples') });
  const keep = new Set(pages.map((p) => p.path));
  const deleted: string[] = [];
  for (const rel of sortedFiles(referenceDir)) {
    if (keep.has(rel)) continue;
    fs.rmSync(path.join(referenceDir, rel));
    deleted.push(rel);
  }
  removeEmptyDirs(referenceDir);
  const written: string[] = [];
  for (const p of pages) {
    const target = path.join(referenceDir, p.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, p.content);
    written.push(p.path);
  }
  return { written, deleted };
}

/** Example files that match no command or tool. Paths are relative to the examples folder, such as `cli/nope.md`. */
export async function orphanExamples(examplesDir: string): Promise<string[]> {
  const known = {
    cli: new Set(leafCommands(inertProgram()).map((l) => l.names.join('-'))),
    mcp: new Set((await listTools()).map((t) => t.name)),
  };
  const orphans: string[] = [];
  for (const sub of ['cli', 'mcp'] as const) {
    for (const slug of readExamples(examplesDir, sub).keys()) {
      if (!known[sub].has(slug)) orphans.push(`${sub}/${slug}.md`);
    }
  }
  return orphans.sort();
}
