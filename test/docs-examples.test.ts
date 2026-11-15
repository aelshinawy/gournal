import fs from 'fs';
import path from 'path';

// Every docs example comes from one seeded journal (site/scripts/examples/seed.ts).
// These tests read the example files and check that the counts agree across pages.
const DIR = path.join(__dirname, '..', 'site', 'src', 'content', 'examples');

function fences(file: string): { lang: string; body: string }[] {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  return [...text.matchAll(/```(\w*)\n([\s\S]*?)\n```/g)].map((m) => ({ lang: m[1], body: m[2] }));
}

/** Output of one console command, keyed by the command line without its "$ " prefix. */
function consoleOutputs(file: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { lang, body } of fences(file)) {
    if (lang !== 'console') continue;
    let cmd: string | null = null;
    for (const line of body.split('\n')) {
      if (line.startsWith('$ ')) {
        cmd = line.slice(2);
        out.set(cmd, []);
      } else if (cmd !== null) {
        out.get(cmd)!.push(line);
      }
    }
  }
  return out;
}

function jsonBlocks(file: string): any[] {
  return fences(file).filter((f) => f.lang === 'json').map((f) => JSON.parse(f.body));
}

/** Lines under a "By project" or "By tag" heading of a stats report. Each line is "name: N". */
function statsSection(lines: string[], heading: string): Record<string, number> {
  const result: Record<string, number> = {};
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) throw new Error(`no "${heading}" section`);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') break;
    const m = line.trim().match(/^#?(\S+): (\d+)$/);
    if (!m) throw new Error(`cannot parse stats line: ${line}`);
    result[m[1]] = Number(m[2]);
  }
  return result;
}

/** Lines of a "name  N" listing, such as the output of `gournal projects` or `gournal tags`. */
function listing(lines: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of lines.filter((l) => l.trim() !== '')) {
    const m = line.match(/^#?(\S+)  (\d+)$/);
    if (!m) throw new Error(`cannot parse listing line: ${line}`);
    result[m[1]] = Number(m[2]);
  }
  return result;
}

const only = <T>(m: Map<string, T>, cmd: string): T => {
  const v = m.get(cmd);
  if (v === undefined) throw new Error(`no example for "${cmd}"`);
  return v;
};

const PROJECTS = { 'billing-api': 5, worker: 3 };
const TAGS = { review: 3, ui: 3, docs: 2 };
const WORKER_TAGS = { ui: 2, docs: 1, review: 1 };

describe('docs examples', () => {
  const stats = consoleOutputs('cli/stats.md');

  test('project counts agree across projects, list_projects, and stats', () => {
    const fromCli = listing(only(consoleOutputs('cli/projects.md'), 'gournal projects'));
    const fromMcp = Object.fromEntries(
      jsonBlocks('mcp/list_projects.md')
        .flatMap((b) => b.projects ?? [])
        .map((p: { project: string; count: number }) => [p.project, p.count]),
    );
    const fromStats = statsSection(only(stats, 'gournal stats'), 'By project');
    expect(fromCli).toEqual(PROJECTS);
    expect(fromMcp).toEqual(PROJECTS);
    expect(fromStats).toEqual(PROJECTS);
  });

  test('entry totals agree across stats, log, index rebuild, and import', () => {
    const total = Object.values(PROJECTS).reduce((a, b) => a + b, 0);
    const statsTotal = only(stats, 'gournal stats').find((l) => l.includes('Total entries'));
    expect(statsTotal).toContain(`: ${total}`);
    expect(only(consoleOutputs('cli/log.md'), 'gournal log').join('\n')).toContain(`${total} entries across 2 projects.`);
    expect(only(consoleOutputs('cli/index-rebuild.md'), 'gournal index rebuild')[0]).toBe(`Search index rebuilt: ${total} entries.`);
    const imp = consoleOutputs('cli/import.md');
    expect(only(imp, 'gournal export -f bundle -o backup.json')[0]).toContain(`Exported ${total} entries`);
    expect(only(imp, 'GOURNAL_HOME=~/other-journal gournal import backup.json')[0]).toMatch(new RegExp(`Imported: (${total} new, 0 updated, 0 unchanged|0 new, 0 updated, ${total} unchanged)`));
  });

  test('tag counts agree across tags, list_tags, and stats', () => {
    const fromCli = listing(only(consoleOutputs('cli/tags.md'), 'gournal tags'));
    const fromStats = statsSection(only(stats, 'gournal stats'), 'By tag');
    expect(fromCli).toEqual(TAGS);
    expect(fromStats).toEqual(TAGS);

    // list_tags and the second stats example both cover the worker project.
    const fromMcp = Object.fromEntries(
      jsonBlocks('mcp/list_tags.md')
        .flatMap((b) => b.tags ?? [])
        .map((t: { tag: string; count: number }) => [t.tag, t.count]),
    );
    const workerStats = only(stats, 'gournal stats -p worker');
    expect(fromMcp).toEqual(WORKER_TAGS);
    expect(statsSection(workerStats, 'By tag')).toEqual(WORKER_TAGS);
    expect(statsSection(workerStats, 'By project')).toEqual({ worker: PROJECTS.worker });
  });

  test('every example file parses to at least one block', () => {
    for (const sub of ['cli', 'mcp']) {
      for (const f of fs.readdirSync(path.join(DIR, sub)).filter((n) => n.endsWith('.md'))) {
        expect(fences(`${sub}/${f}`).length).toBeGreaterThan(0);
      }
    }
  });
});
