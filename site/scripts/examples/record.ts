// Record every docs example from one seeded journal.
// Usage: npm run build
//        node -r ts-node/register/transpile-only site/scripts/examples/record.ts [--write] [--work <dir>]
// The script seeds a temp home, runs each command, and makes in-process MCP calls.
// It prints each example in README order and saves it in a staging folder.
// It overwrites site/src/content/examples only when you pass --write.
// It never touches the real ~/.gournal or ~/.claude.
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../../src/adapters/mcp';
import { openJournal } from '../../../src/storage/journal';

const R = path.resolve(__dirname, '../../..');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const workAt = argv.indexOf('--work');
const workArg = workAt >= 0 ? argv[workAt + 1] : undefined;
if (workAt >= 0 && (!workArg || workArg.startsWith('--'))) {
  process.stderr.write('record: --work needs a folder\n');
  process.exit(2);
}
if (workArg && fs.existsSync(workArg) && fs.readdirSync(workArg).length > 0) {
  process.stderr.write(`record: --work folder ${workArg} is not empty\n`);
  process.exit(2);
}

const realHome = os.userInfo().homedir;
const S = path.resolve(workArg ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-examples-')));
if (S === realHome || S === path.join(realHome, '.gournal') || S.startsWith(path.join(realHome, '.gournal') + path.sep)) {
  process.stderr.write(`record: refusing to work in ${S}\n`);
  process.exit(2);
}
if (!fs.existsSync(path.join(R, 'dist/cli.js'))) {
  process.stderr.write('record: run `npm run build` first\n');
  process.exit(2);
}
fs.mkdirSync(S, { recursive: true });
const STAGE = path.join(S, 'out');
const OUT = WRITE ? path.join(R, 'site/src/content/examples') : STAGE;
fs.mkdirSync(path.join(OUT, 'cli'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'mcp'), { recursive: true });

// A scratch bin folder holds a `gournal` link and a `node` link.
// The `setup claude` runs use only that folder plus the system folders, so no `claude` program is found.
fs.mkdirSync(path.join(S, 'bin'), { recursive: true });
fs.rmSync(path.join(S, 'bin/gournal'), { force: true });
fs.symlinkSync(path.join(R, 'dist/cli.js'), path.join(S, 'bin/gournal'));
fs.chmodSync(path.join(R, 'dist/cli.js'), 0o755);
fs.rmSync(path.join(S, 'bin/node'), { force: true });
fs.symlinkSync(process.execPath, path.join(S, 'bin/node'));
const FAKE_GH = path.join(R, 'site/scripts/examples/fake-gh.js');
const PATHV = [path.join(S, 'bin'), process.env.PATH ?? ''].join(':');
const NO_CLAUDE_PATH = `${path.join(S, 'bin')}:/usr/bin:/bin`;

// Seed once. Every example copies this seed.
const base = path.join(S, 'base');
fs.rmSync(base, { recursive: true, force: true });
execFileSync('node', ['-r', 'ts-node/register/transpile-only', path.join(R, 'site/scripts/examples/seed.ts'), base], { cwd: R, stdio: 'inherit', env: { ...process.env, HOME: base, GOURNAL_HOME: base } });

const written: string[] = [];
function fresh(name: string): string {
  fs.rmSync(`${S}/${name}`, { recursive: true, force: true });
  fs.cpSync(`${S}/base`, `${S}/${name}`, { recursive: true });
  return `${S}/${name}`;
}
function sh(home: string, cmd: string, extra: Record<string, string> = {}): string {
  const cwd = fs.existsSync(`${home}/dev/billing-api`) ? `${home}/dev/billing-api` : home;
  const env = { ...process.env, PATH: PATHV, HOME: home, GOURNAL_HOME: home, GOURNAL_NO_AUTOSYNC: '1', ...extra };
  let out: string;
  try { out = execSync(`${cmd} 2>&1`, { cwd, env, encoding: 'utf8', shell: '/bin/sh' }); } catch (e: any) { out = String(e.stdout); }
  return out.replace(/\n+$/, '');
}
const w = (rel: string, body: string) => {
  fs.writeFileSync(path.join(OUT, rel), body.replace(/\n*$/, '\n'));
  written.push(rel);
};
const block = (lang: string, body: string) => '```' + lang + '\n' + body.replace(/\n+$/, '') + '\n```';
const q = (s: string) => `"${s}"`;
const idOf = (home: string, summary: string): string => {
  const out = sh(home, 'gournal log');
  const line = out.split('\n').find((l) => l.includes(summary));
  return line!.trim().split(/\s+/)[1];
};
const cli = (home: string, cmd: string, extra?: Record<string, string>) => `$ ${cmd}\n${sh(home, cmd, extra)}`;

function main() {
  // Read-only pages come from a copy of the seed.
  const ro = fresh('ro');
  w('cli/projects.md', `List every project with its number of entries.\n\n${block('console', cli(ro, 'gournal projects'))}`);
  w('cli/tags.md', `List every tag with its number of entries. The most used tags come first.\n\n${block('console', cli(ro, 'gournal tags'))}`);
  w('cli/log.md', `Show every entry of today in time order, with the project and tags of each entry.\n\n${block('console', cli(ro, 'gournal log'))}`);
  w('cli/index-rebuild.md', `Rebuild the search index. The command prints the number of entries that it indexed.\n\n${block('console', cli(ro, 'gournal index rebuild'))}`);
  w('cli/standup.md', `Show today's standup. The report lists done entries by project, then open blockers and next items.\n\n${block('console', cli(ro, 'gournal standup'))}`);
  w('cli/stats.md', `Show the totals, your streak, and the entries for each project and tag.\n\n${block('console', cli(ro, 'gournal stats'))}\n\nLimit the numbers to one project.\n\n${block('console', cli(ro, 'gournal stats -p worker'))}`);
  w('cli/find.md', `Find entries that match a word.\n\n${block('console', cli(ro, 'gournal find rounding'))}\n\nCombine the search with filters. This command finds open blockers only.\n\n${block('console', cli(ro, 'gournal find webhook --kind blocker --status open'))}`);
  w('cli/export.md', `Export the entries of one project as Markdown.\n\n${block('console', cli(ro, 'gournal export -p billing-api'))}\n\nExport entries that have a tag as CSV.\n\n${block('console', cli(ro, 'gournal export -f csv -t ui'))}`);

  // Each state change runs in its own copy of the seed.
  let h = fresh('add');
  const a1 = cli(h, `gournal add ${q('Fix the stale totals in the invoice PDF')} -t review,docs -d ${q('The PDF showed the total before the discount.')}`);
  const a2 = cli(h, `gournal add ${q('Cannot reproduce the failing PDF render in staging')} -k blocker -t review`);
  const a3 = cli(h, `gournal add ${q('Add a regression test for PDF totals')} -k next -t review,docs`);
  w('cli/add.md', `Add an entry. Gournal prints the short id of the new entry.\n\n${block('console', a1)}\n\nAdd a blocker or a next item with \`--kind\`. Gournal takes the project, repo, and branch from the current directory.\n\n${block('console', `${a2}\n\n${a3}`)}`);

  h = fresh('resolve');
  const bid = idOf(h, 'Cannot reproduce the failing webhook retry');
  const r1 = cli(h, 'gournal standup -p billing-api');
  const r2 = cli(h, `gournal resolve ${bid}`);
  const r3 = cli(h, 'gournal standup -p billing-api');
  w('cli/resolve.md', `Resolve an open blocker. Pass the short id from the standup report. The entry then leaves the Blockers list.\n\n${block('console', `${r1}\n\n${r2}\n\n${r3}`)}`);

  h = fresh('undo');
  const u1 = cli(h, `gournal add ${q('Draft the release notes for 2.4')} -t docs`);
  const u2 = cli(h, 'gournal undo');
  w('cli/undo.md', `Remove the last entry that you added on this device. The command prints the id that restores it.\n\n${block('console', `${u1}\n\n${u2}`)}`);
  const rid = u2.match(/restore ([0-9A-Z]{8})\)/)![1];
  w('cli/restore.md', `Bring back an entry that you removed. Pass the short id that \`undo\` printed.\n\n${block('console', cli(h, `gournal restore ${rid}`))}`);

  h = fresh('clear');
  w('cli/clear.md', `The command needs a terminal so that it can ask you to confirm. Without a terminal, it refuses and removes nothing. This example ran with the input redirected from \`/dev/null\`.\n\n${block('console', cli(h, 'gournal clear </dev/null'))}\n\nThe command exits with status 1.`);

  h = fresh('import');
  fs.rmSync(`${S}/other`, { recursive: true, force: true }); fs.mkdirSync(`${S}/other`);
  const i1 = cli(h, 'gournal export -f bundle -o backup.json');
  const disp = (c: string) => c.replace(`${S}/other`, '~/other-journal');
  const i2 = disp(`$ GOURNAL_HOME=~/other-journal gournal import backup.json\n${sh(h, `GOURNAL_HOME=${S}/other gournal import backup.json`)}`);
  const i3 = disp(`$ GOURNAL_HOME=~/other-journal gournal import backup.json\n${sh(h, `GOURNAL_HOME=${S}/other gournal import backup.json`)}`);
  w('cli/import.md', `Make a bundle file, then load it into another journal. Set \`GOURNAL_HOME\` to the folder of the other journal. This example imports into an empty journal.\n\n${block('console', `${i1}\n\n${i2}`)}\n\nImport the same file again into that journal. Gournal finds the same entries and changes nothing.\n\n${block('console', i3)}`);

  h = fresh('sync');
  const s1 = cli(h, 'gournal sync --since 2026-11-01', { GOURNAL_GH: FAKE_GH });
  const s2 = `$ gournal sync\n${sh(h, 'gournal sync', { GOURNAL_GH: '/nonexistent/gh' })}`;
  w('cli/sync.md', `Fetch GitHub activity through the gh CLI. This example uses a stand-in gh program with fixture data for the \`acme\` and \`octo\` owners.\n\n${block('console', s1)}\n\nAfter an earlier sync worked, a later sync without a working gh CLI reports why it stopped. A new user who never synced sees \`GitHub sync failed (gh is not installed; see https://cli.github.com)\` instead.\n\n${block('console', s2)}`);

  h = fresh('setup');
  const sub = (t: string) => t.split(h).join('/Users/you');
  const c1 = sub(cli(h, 'gournal setup claude --yes --hook', { PATH: NO_CLAUDE_PATH }));
  const c2 = sub(cli(h, 'gournal setup claude --yes', { PATH: NO_CLAUDE_PATH }));
  w('cli/setup-claude.md', `Set gournal up for Claude Code. This example ran with a fresh home folder that has no claude CLI. The command prints the step that you run yourself, and it writes the skill and the Stop hook.\n\n${block('console', c1)}\n\nRun the command again. The skill step now reports that it is already set up.\n\n${block('console', c2)}`);
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
async function mcp(name: string, fn: (call: (n: string, a: Record<string, unknown>) => Promise<any>, home: string) => Promise<void>) {
  const home = fresh(name);
  process.env.GOURNAL_NO_AUTOSYNC = '1';
  const saved = { HOME: process.env.HOME, GOURNAL_HOME: process.env.GOURNAL_HOME };
  process.env.HOME = home;
  process.env.GOURNAL_HOME = home;
  const journal = openJournal(home);
  const server = createServer({ journal });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'docs', version: '1.0.0' });
  await Promise.all([c.connect(ct), server.connect(st)]);
  const call = (n: string, a: Record<string, unknown>) => c.callTool({ name: n, arguments: a }) as Promise<any>;
  try { await fn(call, home); } finally {
    journal.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

async function mcpAll() {
  await mcp('m_add', async (call, home) => {
    const input = {
      summary: 'Fix the stale totals in the invoice PDF',
      details: 'The PDF showed the total before the discount.',
      project: 'billing-api', cwd: `${home}/dev/billing-api`, tags: ['review', 'docs'],
      refs: [{ type: 'pr', value: '412', repo: 'acme/billing-api' }],
    };
    const r = await call('add_entry', input);
    const shown = { ...input, cwd: '/Users/you/dev/billing-api' };
    w('mcp/add_entry.md', `Log a finished piece of work. Pass \`project\` and \`cwd\`.\n\n${block('json', json(shown))}\n\nThe text result:\n\n${block('text', r.content[0].text)}\n\nThe structured result:\n\n${block('json', json(r.structuredContent))}`);
  });
  await mcp('m_delete', async (call, home) => {
    const id = idOf(home, 'Document the invoice export endpoint');
    const r = await call('delete_entry', { id });
    w('mcp/delete_entry.md', `Delete an entry. The entry stays in the database. The text result tells you the command that restores it.\n\n${block('json', json({ id }))}\n\nThe text result:\n\n${block('text', r.content[0].text)}\n\nThe structured result has the same shape as the \`add_entry\` result. The \`deletedAt\` field holds the time of the deletion.\n\n${block('json', json(r.structuredContent))}`);
  });
  await mcp('m_find', async (call) => {
    const input = { text: 'rounding', kind: ['done', 'next'], limit: 5 };
    const r = await call('find_entries', input);
    const sc = { ...r.structuredContent, entries: [r.structuredContent.entries[0], `... ${r.structuredContent.entries.length - 1} more`] };
    w('mcp/find_entries.md', `Find done and next entries that match a word.\n\n${block('json', json(input))}\n\nThe text result:\n\n${block('markdown', r.content[0].text)}\n\nThe structured result lists each entry with all of its fields. This example shows the first entry only.\n\n${block('json', json(sc))}`);
  });
  await mcp('m_standup', async (call) => {
    const input = { project: 'billing-api' };
    const r = await call('get_standup', input);
    const sc = { ...r.structuredContent, done: r.structuredContent.done.map((g: any) => ({ ...g, entries: ['...'] })), blockers: ['...'], next: ['...'] };
    w('mcp/get_standup.md', `Get today's standup for one project.\n\n${block('json', json(input))}\n\nThe text result:\n\n${block('markdown', r.content[0].text)}\n\nThe structured result holds the same data as JSON. This example shows the entries as \`...\` to stay short.\n\n${block('json', json(sc))}`);
  });
  await mcp('m_list', async (call) => {
    const input = { project: 'worker', limit: 2 };
    const r = await call('list_entries', input);
    w('mcp/list_entries.md', `List the two newest entries of one project. Pass a low \`limit\` so that the result stays short.\n\n${block('json', json(input))}\n\nThe structured result. The text result holds the \`entries\` list as JSON.\n\n${block('json', json(r.structuredContent))}`);
    const p = await call('list_projects', {});
    w('mcp/list_projects.md', `List every project with its number of entries. The tool takes no input.\n\n${block('json', '{}')}\n\nThe structured result:\n\n${block('json', json(p.structuredContent))}\n\nThe text result holds the \`projects\` list as JSON.`);
    const tin = { project: 'worker' };
    const t = await call('list_tags', tin);
    const tags = t.structuredContent.tags.map((x: any) => `    ${JSON.stringify(x).replace('{"', '{ "').replace('}', ' }').replace(/,"/g, ', "').replace(/:/g, ': ')}`).join(',\n');
    w('mcp/list_tags.md', `List the tags of one project before you add an entry. Reuse these names.\n\n${block('json', json(tin))}\n\nThe structured result:\n\n${block('json', `{\n  "tags": [\n${tags}\n  ]\n}`)}\n\nThe text result holds the \`tags\` list as JSON.`);
  });
  await mcp('m_resolve', async (call, home) => {
    const id = idOf(home, 'Add a regression test for tax rounding');
    const r = await call('resolve_entry', { id });
    w('mcp/resolve_entry.md', `Resolve an open next item. Pass the short id.\n\n${block('json', json({ id }))}\n\nThe text result:\n\n${block('text', r.content[0].text)}\n\nThe structured result:\n\n${block('json', json(r.structuredContent))}`);
  });
  await mcp('m_update', async (call, home) => {
    const id = idOf(home, 'Document the invoice export endpoint');
    const input = { id, summary: 'Document the invoice export endpoint and its limits', tags: ['docs', 'review'], refs: [{ type: 'pr', value: '415', repo: 'acme/billing-api' }] };
    const r = await call('update_entry', input);
    w('mcp/update_entry.md', `Fix the summary of an entry, replace its tags, and add a pull request reference. Fields that you omit stay as they are.\n\n${block('json', json(input))}\n\nThe text result:\n\n${block('text', r.content[0].text)}\n\nThe structured result:\n\n${block('json', json(r.structuredContent))}`);
  });
}

main();
mcpAll().then(
  () => {
    // Print in README order: read-only commands, state changes, then MCP.
    for (const rel of written) process.stdout.write(`\n===== ${rel}\n${fs.readFileSync(path.join(OUT, rel), 'utf8')}`);
    process.stdout.write(`\nrecord: wrote ${written.length} examples to ${OUT}${WRITE ? '' : ' (staging only; pass --write to replace the site examples)'}\n`);
    process.exit(0);
  },
  (e) => { console.error(e); process.exit(1); },
);
