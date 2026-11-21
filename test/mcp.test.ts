import { execFileSync } from 'child_process';
import { forceColor } from '../src/render/style';
import { formatDay } from '../src/core/dates';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

import { fileURLToPath, pathToFileURL } from 'url';
import { createServer, SERVER_INSTRUCTIONS, type ServerDeps } from '../src/adapters/mcp';
import { GhError, resolveIdentity, type GhRunner } from '../src/sources';
import type { NewEntryInput } from '../src/core';
import { openJournal, type Journal } from '../src/storage/journal';
import { makeRealTmp, makeTmp, rmTmp } from './helpers/tmp';

let home: string;
let journal: Journal;
let client: Client;

const text = (r: any): string => r.content[0].text;
const seed = (summary: string, o: Partial<NewEntryInput> = {}) =>
  journal.repo.add({ summary, project: 'p', source: 'mcp', ...o });
const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<any>;

const identityStub = jest.fn((cwd: string) => ({ project: 'stub-project', repo: 'o/stub', branch: `b-${cwd}` }));
const processCwd = jest.fn(() => '/proc');

async function connect(j?: Journal, deps: Partial<ServerDeps> = {}, roots?: string[]) {
  const server = createServer({ journal: j, identity: identityStub, processCwd, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '1.0.0' }, roots ? { capabilities: { roots: {} } } : undefined);
  if (roots) c.setRequestHandler('roots/list', async () => ({ roots: roots.map(r => ({ uri: pathToFileURL(r).href })) }));
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  return c;
}

beforeEach(async () => {
  home = makeTmp('gournal-mcp-');
  journal = openJournal(home);
  client = await connect(journal);
  identityStub.mockClear();
  processCwd.mockClear();
});
afterEach(() => {
  journal.close();
  rmTmp(home);
});

test('server sends the instructions', () => {
  expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
});

test('server reports the package version', () => {
  expect(client.getServerVersion()?.version).toBe(require('../package.json').version);
});

test('add_entry stores summary, details, kind, refs', async () => {
  const r = await call('add_entry', {
    summary: 'Shipped the thing', details: 'More text', kind: 'next', project: 'gournal',
    tags: ['feature'], refs: [{ type: 'pr', value: '12' }], agent: 'claude',
  });
  expect(r.isError).toBeFalsy();
  const [e] = journal.repo.find();
  expect(e).toMatchObject({ summary: 'Shipped the thing', details: 'More text', kind: 'next', project: 'gournal', tags: ['feature'], source: 'mcp', agent: 'claude' });
  expect(e.refs).toEqual([{ type: 'pr', value: '12' }]);
  expect(text(r).split('\n')[0]).toBe(`Entry ${e.id.slice(-8)} added to gournal: Shipped the thing`);
});

test('a missing summary is a tool error without structured content', async () => {
  const r = await call('add_entry', { project: 'p' });
  expect(r.isError).toBe(true);
  expect(text(r)).toBe('summary is required');
  expect(r.structuredContent).toBeUndefined();
});

test.each([
  ['no project and no cwd', { summary: 'No project passed' }, '/proc'],
  ['a cwd', { summary: 'With cwd', cwd: '/work' }, '/work'],
])('add_entry takes project, repo, and branch from the identity: %s', async (_name, args, dir) => {
  await call('add_entry', args);
  expect(journal.repo.find()[0]).toMatchObject({ project: 'stub-project', repo: 'o/stub', branch: `b-${dir}` });
});

test('explicit fields win per field over cwd', async () => {
  await call('add_entry', { summary: 'Mixed', cwd: '/work', project: 'mine' });
  expect(journal.repo.find().find(e => e.summary === 'Mixed')).toMatchObject({ project: 'mine', repo: 'o/stub', branch: 'b-/work' });
  await call('add_entry', { summary: 'Mixed two', cwd: '/work', branch: 'x', repo: 'a/b' });
  expect(journal.repo.find().find(e => e.summary === 'Mixed two')).toMatchObject({ project: 'stub-project', repo: 'a/b', branch: 'x' });
});

test('process cwd is not used when project is explicit', async () => {
  await call('add_entry', { summary: 'Explicit', project: 'mine' });
  expect(identityStub).not.toHaveBeenCalled();
  expect(journal.repo.find()[0]).toMatchObject({ project: 'mine', repo: null, branch: null });
});

test('the first client root is used when cwd is missing', async () => {
  const c = await connect(journal, {}, ['/root-a', '/root-b']);
  await c.callTool({ name: 'add_entry', arguments: { summary: 'From root' } });
  // On Windows the root becomes a drive path such as D:\root-a.
  expect(journal.repo.find()[0].branch).toBe(`b-${fileURLToPath(pathToFileURL('/root-a'))}`);
  expect(processCwd).not.toHaveBeenCalled();
});

test('a client that never answers roots/list falls back to the process cwd within the roots timeout', async () => {
  const server = createServer({ journal, identity: identityStub, processCwd });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'silent-roots', version: '1.0.0' }, { capabilities: { roots: {} } });
  c.setRequestHandler('roots/list', () => new Promise(() => undefined));
  await Promise.all([c.connect(ct), server.connect(st)]);
  const started = Date.now();
  const r = await c.callTool({ name: 'add_entry', arguments: { summary: 'Silent roots' } }) as any;
  expect(r.isError).toBeFalsy();
  expect(Date.now() - started).toBeLessThan(5000);
  expect(journal.repo.find()[0].branch).toBe('b-/proc');
  await c.close();
});

test('a relative cwd is ignored', async () => {
  const c = await connect(journal, {});
  await c.callTool({ name: 'add_entry', arguments: { summary: 'Relative', cwd: 'some/dir' } });
  expect(identityStub).toHaveBeenCalledTimes(1);
  expect(identityStub).toHaveBeenCalledWith('/proc');
});

test('the default identity applies config aliases to a real repo', async () => {
  const repoDir = makeRealTmp('gournal-git-');
  try {
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-C', repoDir, ...a], { stdio: 'ignore' });
    g('init'); g('remote', 'add', 'origin', 'git@github.com:acme/collection-app.git'); g('commit', '--allow-empty', '-m', 'i');
    const aliased = { repo: journal.repo, activity: journal.activity, config: { ...journal.config, projectAliases: { 'acme/collection-app': 'Collection' } } };
    const c = await connect(undefined, { journal: aliased, identity: undefined });
    await c.callTool({ name: 'add_entry', arguments: { summary: 'Real', cwd: repoDir } });
    expect(journal.repo.find()[0]).toMatchObject({ project: 'Collection', repo: 'acme/collection-app', branch: 'main' });
  } finally {
    rmTmp(repoDir);
  }
});

test('bad cwd never blocks add_entry', async () => {
  const c = await connect(journal, { identity: (cwd: string) => resolveIdentity(cwd, {}) });
  const r: any = await c.callTool({ name: 'add_entry', arguments: { summary: 'Bad cwd', cwd: '/no/such/dir' } });
  expect(r.isError).toBeFalsy();
  expect(journal.repo.find()[0].project).toBe('uncategorized');
});

test('unknown ids and bad resolves return tool errors', async () => {
  for (const [name, args] of [
    ['update_entry', { id: 'NOPE1234', summary: 'x' }],
    ['delete_entry', { id: 'NOPE1234' }],
    ['resolve_entry', { id: 'NOPE1234' }],
  ] as const) {
    const r = await call(name, args);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('No entry with id');
  }
  await call('add_entry', { summary: 'done one', project: 'p' });
  const r = await call('resolve_entry', { id: journal.repo.find()[0].id.slice(-8) });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('only an open blocker or next');
});

test('list_entries respects limit and project filter', async () => {
  seed('a', { project: 'api', createdAt: '2026-07-13T10:00:00.000Z' });
  seed('b', { project: 'infra', createdAt: '2026-07-13T10:00:01.000Z' });
  seed('c', { project: 'api', createdAt: '2026-07-13T10:00:02.000Z' });
  expect(JSON.parse(text(await call('list_entries', { limit: 1 }))).map((e: any) => e.summary)).toEqual(['c']);
  expect(JSON.parse(text(await call('list_entries', { project: 'api' }))).map((e: any) => e.summary)).toEqual(['c', 'a']);
});

test('list_entries "to" date includes that whole day', async () => {
  journal.repo.add({ summary: 'late', project: 'p', source: 'mcp', createdAt: new Date(2026, 6, 13, 23, 30).toISOString() });
  const res = await call('list_entries', { to: '2026-07-13' });
  expect(JSON.parse(text(res))).toHaveLength(1);
});

test('list_entries filters by from', async () => {
  journal.repo.add({ summary: 'old', project: 'p', source: 'mcp', createdAt: '2026-07-12T10:00:00.000Z' });
  journal.repo.add({ summary: 'new', project: 'p', source: 'mcp', createdAt: '2026-07-13T10:00:00.000Z' });
  const res = await call('list_entries', { from: '2026-07-13T00:00:00.000Z' });
  expect(JSON.parse(text(res)).map((e: any) => e.summary)).toEqual(['new']);
});

test('get_standup renders added entries', async () => {
  await call('add_entry', { summary: 'Fixed auth middleware', project: 'api' });
  await call('add_entry', { summary: 'Updated Docker config', project: 'infra' });
  const all = text(await call('get_standup', { month: true }));
  expect(all).toContain('Fixed auth middleware');
  const filtered = text(await call('get_standup', { month: true, project: 'api' }));
  expect(filtered).toContain('Fixed auth middleware');
  expect(filtered).not.toContain('Updated Docker config');
});

test('export_entries defaults to markdown and includes details; csv filters by project', async () => {
  await call('add_entry', { summary: 'Fixed auth', details: 'deep detail', project: 'api' });
  await call('add_entry', { summary: 'Docker', project: 'infra' });
  const md = text(await call('export_entries'));
  expect(md).toContain('Fixed auth');
  expect(md).toContain('deep detail');
  const csv = text(await call('export_entries', { format: 'csv', project: 'infra' }));
  expect(csv).toContain('Docker');
  expect(csv).not.toContain('Fixed auth');
});

test('without a passed journal the server opens GOURNAL_HOME lazily', async () => {
  const prev = process.env.GOURNAL_HOME;
  process.env.GOURNAL_HOME = home;
  try {
    const exitListeners = new Set(process.listeners('exit'));
    const lazy = await connect();
    const r = (await lazy.callTool({ name: 'add_entry', arguments: { summary: 'lazy', project: 'p' } })) as any;
    expect(r.isError).toBeFalsy();
    expect(journal.repo.find().map(e => e.summary)).toContain('lazy');
    // The server closes its journal on process exit. Run that handler now.
    // Windows cannot delete the home directory while the lazy journal holds the database open.
    const added = process.listeners('exit').filter((l) => !exitListeners.has(l));
    expect(added).toHaveLength(1);
    for (const l of added) { l(0); process.removeListener('exit', l); }
  } finally {
    if (prev === undefined) delete process.env.GOURNAL_HOME; else process.env.GOURNAL_HOME = prev;
  }
});

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

test('find_entries filters by kind and text and returns structured entries', async () => {
  seed('Stuck on CI', { kind: 'blocker' }); seed('Shipped CI fix');
  const r = await call('find_entries', { text: 'ci', kind: ['blocker'] });
  expect(r.structuredContent.entries.map((e: any) => e.summary)).toEqual(['Stuck on CI']);
  expect(r.structuredContent.count).toBe(1);
  expect(text(r)).toContain('Stuck on CI (blocker, open)');
});

test('find_entries defaults to newest first and honours order, limit, status, source, and includeDeleted', async () => {
  seed('one', { createdAt: '2026-07-13T10:00:00.000Z' });
  seed('two', { createdAt: '2026-07-13T10:00:01.000Z', kind: 'blocker' });
  const gone = seed('three', { createdAt: '2026-07-13T10:00:02.000Z', source: 'cli' });
  journal.repo.softDelete(gone.id);
  const names = (r: any) => r.structuredContent.entries.map((e: any) => e.summary);
  expect(names(await call('find_entries'))).toEqual(['two', 'one']);
  expect(names(await call('find_entries', { order: 'asc' }))).toEqual(['one', 'two']);
  expect(names(await call('find_entries', { limit: 1 }))).toEqual(['two']);
  expect(names(await call('find_entries', { status: 'open' }))).toEqual(['two']);
  expect(names(await call('find_entries', { source: 'cli', includeDeleted: true }))).toEqual(['three']);
  expect(names(await call('find_entries', { source: 'cli' }))).toEqual([]);
});

test('find_entries rejects a limit above 500', async () => {
  const r = await call('find_entries', { limit: 501 });
  expect(r.isError).toBe(true);
});

test('list_entries is newest first, keeps JSON text, and adds structured entries', async () => {
  seed('a', { createdAt: '2026-07-13T10:00:00.000Z' });
  seed('b', { createdAt: '2026-07-13T10:00:01.000Z' });
  seed('c', { createdAt: '2026-07-13T10:00:02.000Z', tags: ['x'] });
  const r = await call('list_entries', { limit: 2 });
  expect(JSON.parse(text(r)).map((e: any) => e.summary)).toEqual(['c', 'b']);
  expect(r.structuredContent.entries.map((e: any) => e.summary)).toEqual(['c', 'b']);
  const tagged = await call('list_entries', { tags: ['x'] });
  expect(JSON.parse(text(tagged)).map((e: any) => e.summary)).toEqual(['c']);
});

test('every data tool declares an outputSchema', async () => {
  const { tools } = await client.listTools();
  for (const n of ['find_entries', 'list_entries', 'get_standup', 'get_work_log', 'list_tags', 'list_projects', 'sync_activity', 'add_entry', 'update_entry', 'delete_entry', 'resolve_entry'])
    expect(tools.find((t) => t.name === n)?.outputSchema).toBeDefined();
  expect(tools.find((t) => t.name === 'export_entries')?.outputSchema).toBeUndefined();
});

test('write tools take id suffixes, persist, and return structured entry and notes', async () => {
  const a = await call('add_entry', { summary: 'first', project: 'p' });
  expect(a.structuredContent.entry.summary).toBe('first');
  expect(a.structuredContent.notes).toEqual([]);
  const id = a.structuredContent.entry.id;
  const short = id.slice(-8);
  const b = await call('add_entry', { summary: 'second', project: 'p', resolves: ['ZZZZZZZZ'] });
  expect(b.structuredContent.notes[0]).toContain('Could not resolve ZZZZZZZZ');
  const u = await call('update_entry', { id: short, summary: 'first edited', tags: ['x'] });
  expect(u.structuredContent.entry.summary).toBe('first edited');
  expect(journal.repo.get(id)).toMatchObject({ summary: 'first edited', tags: ['x'] });
  const blk = seed('blk', { kind: 'blocker' });
  const r = await call('resolve_entry', { id: blk.id.slice(-8), by: short });
  expect(r.structuredContent.entry.status).toBe('resolved');
  expect(journal.repo.get(blk.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: id });
  const d = await call('delete_entry', { id: short });
  expect(d.structuredContent.entry.deletedAt).not.toBeNull();
  expect(text(d)).toBe(`Entry ${short} removed: first edited\nrestore with gournal restore ${short}`);
  expect(journal.repo.get(id)!.deletedAt).not.toBeNull();
});

test('add_entry text lists the header, similar-tag notes, dropped resolves, then the split note', async () => {
  seed('first', { tags: ['review'] });
  const long = `${'word '.repeat(40)}end.`;
  const r = await call('add_entry', { summary: long, details: 'given', project: 'p', tags: ['reveiw'], resolves: ['ZZZZZZZZ'] });
  const e = r.structuredContent.entry;
  const notes = [
    'New tag "reveiw". Close existing tags: review',
    'Could not resolve ZZZZZZZZ: No entry with id "ZZZZZZZZ"',
    'Summary was too long and was split; full text is in details.',
  ];
  expect(text(r)).toBe([`Entry ${e.id.slice(-8)} added to p: ${e.summary}`, ...notes].join('\n'));
  expect(r.structuredContent.notes).toEqual(notes);
});

test('update_entry splits a long summary with a note, and splits a rejected one on retry', async () => {
  const note = 'Summary was too long and was split; full text is in details.';
  const e = seed('one');
  const withDetails = await call('update_entry', { id: e.id.slice(-8), summary: `${'word '.repeat(40)}end.`, details: 'given' });
  expect(withDetails.structuredContent.notes).toEqual([note]);
  const long = `${'retry '.repeat(40)}end.`;
  const f = seed('two');
  const first = await call('update_entry', { id: f.id, summary: long });
  expect(first.isError).toBe(true);
  expect(journal.repo.get(f.id)).toEqual(f);
  const second = await call('update_entry', { id: f.id, summary: long });
  expect(second.isError).toBeFalsy();
  expect(second.structuredContent.entry.details).toBe(long);
  expect(second.structuredContent.notes).toEqual([note]);
});

test('a retry through the server is split', async () => {
  const long = `${'word '.repeat(40)}end.`;
  expect((await call('add_entry', { summary: long, project: 'p' })).isError).toBe(true);
  const second = await call('add_entry', { summary: long, project: 'p' });
  expect(second.isError).toBeFalsy();
  expect(second.structuredContent.entry.details).toBe(long);
  expect(second.structuredContent.entry.summary.length).toBeLessThanOrEqual(120);
});

test('get_standup carries an older open blocker forward even with from', async () => {
  seed('Old blocker', { kind: 'blocker', createdAt: daysAgo(3) });
  seed('Did a thing');
  const today = formatDay(new Date());
  const r = await call('get_standup', { from: today });
  expect(r.structuredContent.blockers.map((e: any) => e.summary)).toEqual(['Old blocker']);
  expect(r.structuredContent.done[0].entries.map((e: any) => e.summary)).toEqual(['Did a thing']);
});

test('get_standup accepts tags, from, and to', async () => {
  seed('Tagged', { tags: ['bug'], createdAt: '2026-07-13T10:00:00.000Z' });
  seed('Untagged', { createdAt: '2026-07-13T11:00:00.000Z' });
  seed('Outside', { tags: ['bug'], createdAt: '2026-07-20T10:00:00.000Z' });
  const r = await call('get_standup', { tags: ['bug'], from: '2026-07-13', to: '2026-07-14' });
  expect(text(r)).toContain('Range (2026-07-13 - 2026-07-14)');
  expect(text(r)).toContain('Tagged');
  expect(text(r)).not.toContain('Untagged');
  expect(text(r)).not.toContain('Outside');
});

test('get_work_log accepts tags, from, and to and returns structured days', async () => {
  seed('In range', { tags: ['bug'], createdAt: '2026-07-13T10:00:00.000Z' });
  seed('Untagged', { createdAt: '2026-07-13T11:00:00.000Z' });
  seed('Out of range', { tags: ['bug'], createdAt: '2026-07-20T10:00:00.000Z' });
  const r = await call('get_work_log', { tags: ['bug'], from: '2026-07-13', to: '2026-07-14' });
  expect(text(r)).toContain('In range');
  expect(text(r)).not.toContain('Untagged');
  expect(text(r)).not.toContain('Out of range');
  expect(r.structuredContent.count).toBe(1);
  expect(r.structuredContent.days[0].entries[0].summary).toBe('In range');
});

test('list_tags and list_projects count entries in the text and structured results', async () => {
  seed('a', { project: 'api', tags: ['bug'] });
  seed('b', { project: 'infra' });
  const tags = await call('list_tags');
  expect(JSON.parse(text(tags))).toEqual([{ tag: 'bug', count: 1 }]);
  expect(tags.structuredContent.tags).toEqual([{ tag: 'bug', count: 1 }]);
  const projects = await call('list_projects');
  const expected = [{ project: 'api', count: 1 }, { project: 'infra', count: 1 }];
  expect(JSON.parse(text(projects))).toEqual(expect.arrayContaining(expected));
  expect(projects.structuredContent.projects).toEqual(expect.arrayContaining(expected));
  expect(projects.structuredContent.projects).toHaveLength(2);
});

test('export_entries caps at 200 by default, keeps the newest, and puts the notice in a second block', async () => {
  for (let i = 1; i <= 201; i++) seed(`Row ${String(i).padStart(3, '0')}`, { createdAt: new Date(Date.UTC(2026, 6, 13, 0, 0, i)).toISOString() });
  const r = await call('export_entries', { format: 'csv' });
  expect(r.content).toHaveLength(2);
  const rows = r.content[0].text.split('\n');
  expect(rows).toHaveLength(201);
  expect(rows[0]).toContain('timestamp');
  expect(r.content[0].text).not.toContain('Showing the newest');
  expect(r.content[0].text).not.toContain('Row 001');
  expect(rows[1]).toContain('Row 002');
  expect(rows[200]).toContain('Row 201');
  expect(r.content[1].text).toBe('(Showing the newest 200 entries. Pass limit or from/to for more.)');
  const all = await call('export_entries', { format: 'csv', limit: 201 });
  expect(all.content).toHaveLength(1);
  expect(all.content[0].text.split('\n')).toHaveLength(202);
});

test('export_entries has no notice below the limit and accepts tags, from, to, and limit', async () => {
  seed('A', { tags: ['t'], createdAt: '2026-07-13T10:00:00.000Z' });
  seed('B', { createdAt: '2026-07-13T11:00:00.000Z' });
  const out = text(await call('export_entries', { tags: ['t'], from: '2026-07-13', to: '2026-07-13' }));
  expect(out).toContain('A');
  expect(out).not.toContain('B');
  expect(out).not.toContain('Showing the newest');
  const cappedResult = await call('export_entries', { limit: 1 });
  const capped = text(cappedResult);
  expect(cappedResult.content[1].text).toContain('Showing the newest 1 entries');
  expect(capped).toContain('B');
  expect(capped).not.toContain('Showing');
});

describe('ANSI', () => {
  let prev: boolean | undefined;
  afterEach(() => { forceColor(prev); });
  test('no tool output contains ANSI with colour forced on', async () => {
    prev = forceColor(true);
    seed('Old blocker', { kind: 'blocker', createdAt: daysAgo(30), tags: ['t'] });
    seed('Done thing', { tags: ['t'] });
    const calls: [string, Record<string, unknown>][] = [
      ['add_entry', { summary: 'added', project: 'p' }],
      ['find_entries', {}], ['list_entries', {}], ['get_standup', {}], ['get_work_log', {}],
      ['list_tags', {}], ['list_projects', {}], ['export_entries', {}], ['export_entries', { format: 'csv' }],
    ];
    for (const [name, args] of calls) {
      const r = await call(name, args);
      expect(r.isError).toBeFalsy();
      for (const block of r.content) expect(block.text).not.toContain('\x1b');
      expect(JSON.stringify(r.structuredContent ?? null)).not.toContain('\x1b');
    }
  });
});

test('a bad from date is a tool error, not a protocol error', async () => {
  for (const name of ['get_standup', 'get_work_log', 'export_entries', 'find_entries', 'list_entries']) {
    const r = await call(name, { from: 'soon' });
    expect(r.isError).toBe(true);
  }
  const r = await call('get_standup', { from: 'soon' });
  expect(text(r)).toContain('Invalid date: soon');
});

describe('sync_activity', () => {
  const ghFor = () => {
    const calls: string[][] = [];
    const gh = (async (args: string[]) => {
      calls.push(args);
      const j = args.join(' ');
      if (j === 'api user') return JSON.stringify({ login: 'Dev' });
      if (j.includes('search/issues')) return JSON.stringify({ total_count: 0, items: [] });
      throw new Error(`no route ${j}`);
    }) as unknown as GhRunner & { calls: string[][] };
    gh.calls = calls;
    return gh;
  };

  test('returns counts as structured content', async () => {
    const gh = ghFor();
    const c = await connect(journal, { gh });
    const r = await c.callTool({ name: 'sync_activity', arguments: {} }) as any;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ status: 'ok', inserted: 0, updated: 0, linked: 0, warning: null });
    expect(typeof r.structuredContent.since).toBe('string');
    expect(text(r)).toContain('Synced GitHub activity since');
  });

  test('a bad since is a tool error and a failed sync reports its warning', async () => {
    const c = await connect(journal, { gh: ghFor() });
    const bad = await c.callTool({ name: 'sync_activity', arguments: { since: 'nope' } }) as any;
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('Invalid date "nope"');
    const down = await connect(journal, { gh: (async () => { throw new GhError('auth', 'x'); }) as GhRunner });
    const r = await down.callTool({ name: 'sync_activity', arguments: {} }) as any;
    expect(r.structuredContent.status).toBe('failed');
    expect(text(r)).toContain('gh is not signed in');
  });

  test('add_entry links to synced activity without the network', async () => {
    journal.activity.upsert([{
      type: 'pr_opened', occurredAt: new Date().toISOString(), repo: 'acme/widgets', branch: 'feat/x',
      externalId: '5', title: 'Add x', url: null, pr: 5, payload: { pr: 5 },
    }]);
    const gh = ghFor();
    const c = await connect(journal, { gh });
    const r = await c.callTool({ name: 'add_entry', arguments: { summary: 'Did x', project: 'p', repo: 'acme/widgets', refs: [{ type: 'pr', value: '5' }] } }) as any;
    const id = r.structuredContent.entry.id;
    expect(journal.activity.linkedTo([id])[id]).toHaveLength(1);
    expect(gh.calls).toHaveLength(0);
  });
});

describe('get_standup and get_work_log with activity', () => {
  const savedNoAuto = process.env.GOURNAL_NO_AUTOSYNC;
  afterEach(() => {
    if (savedNoAuto === undefined) delete process.env.GOURNAL_NO_AUTOSYNC; else process.env.GOURNAL_NO_AUTOSYNC = savedNoAuto;
  });
  const merged = (over: Record<string, unknown> = {}) => ({
    type: 'pr_merged' as const, occurredAt: new Date().toISOString(), repo: 'acme/widgets', branch: null,
    externalId: 'm327', title: 'Add widget cache', url: null, pr: 327, payload: { pr: 327 }, ...over,
  });
  const down = (async () => { throw new GhError('auth', 'x'); }) as GhRunner;

  test('get_standup JSON contains the full activity list and its markdown is collapsed', async () => {
    journal.activity.upsert([merged(), merged({ type: 'review', externalId: 'r1', repo: 'octo/app', pr: 412, title: 'Fix login', payload: { pr: 412 } })]);
    const r = await call('get_standup');
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.also.activity).toHaveLength(2);
    expect(r.structuredContent.also.counts).toMatchObject({ prsMerged: 1, reviews: 1, repos: 2 });
    expect(r.structuredContent.syncWarning).toBeNull();
    expect(text(r)).toContain('- Also: 1 PR merged, 1 review in 2 repos');
    expect(text(r)).not.toContain('Also happened');
  });

  test('get_standup carries linked activity under an entry', async () => {
    journal.activity.upsert([merged({ pr: 5, payload: { pr: 5 }, externalId: 'm5', title: 'Add x' })]);
    const e = journal.repo.add({ summary: 'Shipped x', project: 'p', source: 'mcp', repo: 'acme/widgets', refs: [{ type: 'pr', value: '5' }] });
    journal.activity.relinkEntries([e.id]);
    const r = await call('get_standup');
    expect(r.structuredContent.linkedActivity[e.id]).toHaveLength(1);
    expect(r.structuredContent.also).toBeNull();
  });

  test('get_standup honours the project and tags filters on activity', async () => {
    journal.activity.upsert([merged(), merged({ externalId: 'g', repo: 'octo/gears', pr: 2, payload: { pr: 2 } })]);
    seed('Tagged', { project: 'widgets', tags: ['bug'] });
    const byProject = await call('get_standup', { project: 'widgets' });
    expect(byProject.structuredContent.also.activity.map((a: any) => a.repo)).toEqual(['acme/widgets']);
    const byTags = await call('get_standup', { tags: ['bug'] });
    expect(byTags.structuredContent.also).toBeNull();
  });

  test.each(['get_standup', 'get_work_log'])('%s adds the sync warning as the last markdown line and as syncWarning', async (name) => {
    delete process.env.GOURNAL_NO_AUTOSYNC;
    journal.close();
    journal = openJournal(home); // the config loader reads the override at open
    seed('Did a thing');
    const c = await connect(journal, { gh: down });
    const r: any = await c.callTool({ name, arguments: {} });
    const warning = 'gournal: GitHub sync skipped (gh is not signed in; run gh auth login); showing stored activity';
    expect(r.structuredContent.syncWarning).toBe(warning);
    expect(text(r).trimEnd().split('\n').pop()).toBe(warning);
    expect(text(r)).toContain('Did a thing');
  });

  test('get_work_log folds linked activity and has no Also section', async () => {
    journal.activity.upsert([merged({ pr: 5, payload: { pr: 5 }, externalId: 'm5', title: 'Add x' })]);
    const e = journal.repo.add({ summary: 'Shipped x', project: 'p', source: 'mcp', repo: 'acme/widgets', refs: [{ type: 'pr', value: '5' }] });
    journal.activity.relinkEntries([e.id]);
    const r = await call('get_work_log');
    expect(r.structuredContent.linkedActivity[e.id]).toHaveLength(1);
    expect(text(r)).not.toContain('Also');
  });
});

describe('tool annotations', () => {
  const expected: Record<string, Record<string, boolean>> = {
    add_entry: { destructiveHint: false },
    update_entry: { destructiveHint: true },
    delete_entry: { destructiveHint: true },
    resolve_entry: { destructiveHint: false },
    find_entries: { readOnlyHint: true },
    list_entries: { readOnlyHint: true },
    list_tags: { readOnlyHint: true },
    list_projects: { readOnlyHint: true },
    export_entries: { readOnlyHint: true },
    get_standup: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    get_work_log: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    sync_activity: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  };

  test('every tool carries its annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(expected).sort());
    for (const t of tools) expect(t.annotations).toMatchObject(expected[t.name]);
  });
});

describe('input caps', () => {
  const x = (n: number) => 'x'.repeat(n);

  test('every string and array the write tools and find text accept is capped in the schema', async () => {
    const { tools } = await client.listTools();
    const schema = (name: string) => tools.find((t) => t.name === name)!.inputSchema as any;
    const uncapped: string[] = [];
    const walk = (path: string, s: any): void => {
      expect(s.$ref).toBeUndefined();
      if (s.type === 'string' && !s.enum && s.maxLength === undefined) uncapped.push(`${path} has no maxLength`);
      if (s.type === 'array') {
        if (s.maxItems === undefined) uncapped.push(`${path} has no maxItems`);
        walk(`${path}[]`, s.items);
      }
      for (const [key, child] of Object.entries(s.properties ?? {})) walk(`${path}.${key}`, child);
    };
    for (const name of ['add_entry', 'update_entry', 'delete_entry', 'resolve_entry']) walk(name, schema(name));
    walk('find_entries.text', schema('find_entries').properties.text);
    expect(uncapped).toEqual([]);
  });

  test.each(['summary', 'message'])('add_entry accepts %s exactly at the cap', async (field) => {
    const r = await call('add_entry', { [field]: x(1000), details: 'd', project: 'p' });
    expect(r.isError).toBeFalsy();
    expect(journal.repo.find()).toHaveLength(1);
  });

  test('add_entry rejects details over the cap, names the field, and stores nothing', async () => {
    const r = await call('add_entry', { summary: 'Capped', project: 'p', details: x(20001) });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/details/);
    expect(journal.repo.find({ includeDeleted: true })).toHaveLength(0);
  });

  test('update_entry over the cap leaves the entry unchanged', async () => {
    const e = seed('Before', { details: 'old details', tags: ['keep'], refs: [{ type: 'pr', value: '9' }] });
    const r = await call('update_entry', { id: e.id, summary: x(1001), details: 'd' });
    expect(r.isError).toBe(true);
    expect(journal.repo.get(e.id)).toEqual(e);
  });
});
