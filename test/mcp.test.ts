import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import chalk from 'chalk';
import { format } from 'date-fns';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { pathToFileURL } from 'url';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer, SERVER_INSTRUCTIONS, type ServerDeps } from '../src/adapters/mcp';
import { GhError, resolveIdentity, type GhRunner } from '../src/sources';
import type { NewEntryInput } from '../src/core';
import { openJournal, type Journal } from '../src/storage/journal';

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
  if (roots) c.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots.map(r => ({ uri: pathToFileURL(r).href })) }));
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  return c;
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-mcp-'));
  journal = openJournal(home);
  client = await connect(journal);
  identityStub.mockClear();
  processCwd.mockClear();
});
afterEach(() => {
  journal.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('server sends the instructions', () => {
  expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  expect(client.getInstructions()).toBe([
    'Gournal is the user\'s work journal. Log each distinct piece of finished work with add_entry.',
    'Always pass project. summary is one line, max 120 characters. Put longer text in details.',
    'Pass cwd (your working directory) so gournal can record the repo and branch.',
    'kind is done (default), blocker (something stops you), or next (a planned next step).',
    'To close a blocker or next item, pass its id in resolves on the done entry, or call resolve_entry.',
    'Reuse existing tags (list_tags). Ticket keys and PR numbers go in refs, not tags.',
    'Call sync_activity to fetch the user\'s GitHub activity. Report tools already sync when the data is stale.',
  ].join('\n'));
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

test('message alias still works', async () => {
  await call('add_entry', { message: 'Old style', project: 'p' });
  expect(journal.repo.find()[0].summary).toBe('Old style');
});

test('missing summary and message is a tool error', async () => {
  const r = await call('add_entry', { project: 'p' });
  expect(r.isError).toBe(true);
  expect(text(r)).toBe('summary is required');
});

test('empty summary is a tool error', async () => {
  const r = await call('add_entry', { summary: '   ', project: 'p' });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('summary is empty');
});

test('add_entry falls back to the process cwd identity when nothing else is given', async () => {
  await call('add_entry', { summary: 'No project passed' });
  expect(journal.repo.find()[0]).toMatchObject({ project: 'stub-project', repo: 'o/stub', branch: 'b-/proc' });
});

test('instructions tell agents to pass cwd', () => expect(SERVER_INSTRUCTIONS).toContain('Pass cwd'));

test('cwd sets project, repo, and branch', async () => {
  await call('add_entry', { summary: 'With cwd', cwd: '/w' });
  expect(journal.repo.find()[0]).toMatchObject({ project: 'stub-project', repo: 'o/stub', branch: 'b-/w' });
});

test('explicit fields win per field over cwd', async () => {
  await call('add_entry', { summary: 'Mixed', cwd: '/w', project: 'mine' });
  expect(journal.repo.find().find(e => e.summary === 'Mixed')).toMatchObject({ project: 'mine', repo: 'o/stub', branch: 'b-/w' });
  await call('add_entry', { summary: 'Mixed two', cwd: '/w', branch: 'x', repo: 'a/b' });
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
  expect(journal.repo.find()[0].branch).toBe('b-/root-a');
  expect(processCwd).not.toHaveBeenCalled();
});

test('a client without roots falls back to the process cwd', async () => {
  const c = await connect(journal, {});
  await c.callTool({ name: 'add_entry', arguments: { summary: 'No roots' } });
  expect(journal.repo.find()[0].branch).toBe('b-/proc');
});

test('a relative cwd is ignored', async () => {
  const c = await connect(journal, {});
  await c.callTool({ name: 'add_entry', arguments: { summary: 'Relative', cwd: 'some/dir' } });
  expect(identityStub).toHaveBeenCalledTimes(1);
  expect(identityStub).toHaveBeenCalledWith('/proc');
});

test('the default identity applies config aliases to a real repo', async () => {
  const repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-git-')));
  try {
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-C', repoDir, ...a], { stdio: 'ignore' });
    g('init'); g('remote', 'add', 'origin', 'git@github.com:acme/collection-app.git'); g('commit', '--allow-empty', '-m', 'i');
    const aliased = { repo: journal.repo, activity: journal.activity, config: { ...journal.config, projectAliases: { 'acme/collection-app': 'Collection' } } };
    const c = await connect(undefined, { journal: aliased, identity: undefined });
    await c.callTool({ name: 'add_entry', arguments: { summary: 'Real', cwd: repoDir } });
    expect(journal.repo.find()[0]).toMatchObject({ project: 'Collection', repo: 'acme/collection-app', branch: 'main' });
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('bad cwd never blocks add_entry', async () => {
  const c = await connect(journal, { identity: (cwd: string) => resolveIdentity(cwd, {}) });
  const r: any = await c.callTool({ name: 'add_entry', arguments: { summary: 'Bad cwd', cwd: '/no/such/dir' } });
  expect(r.isError).toBeFalsy();
  expect(journal.repo.find()[0].project).toBe('uncategorized');
});

test('long summary is rejected with the fix', async () => {
  const r = await call('add_entry', { summary: 'x'.repeat(200), project: 'p' });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('max 120');
  expect(journal.repo.find()).toHaveLength(0);
});

test('retry of a rejected summary is split, not rejected', async () => {
  const long = `${'word '.repeat(40)}end.`;
  expect((await call('add_entry', { summary: long, project: 'p' })).isError).toBe(true);
  const r = await call('add_entry', { summary: long, project: 'p' });
  expect(r.isError).toBeFalsy();
  expect(text(r)).toContain('Summary was too long and was split; full text is in details.');
  const [e] = journal.repo.find();
  expect(e.summary.length).toBeLessThanOrEqual(120);
  expect(e.details).toBe(long);
});

test('a retry that starts with the first 60 characters is also split', async () => {
  const head = 'a'.repeat(60);
  await call('add_entry', { summary: `${head}${'b'.repeat(100)}`, project: 'p' });
  const r = await call('add_entry', { summary: `${head}${'c'.repeat(100)}`, project: 'p' });
  expect(r.isError).toBeFalsy();
});

test('an unrelated long summary is still rejected after a rejection', async () => {
  await call('add_entry', { summary: 'a'.repeat(200), project: 'p' });
  const r = await call('add_entry', { summary: 'z'.repeat(200), project: 'p' });
  expect(r.isError).toBe(true);
});

test('long summary with details is split', async () => {
  const long = `${'word '.repeat(40)}end.`;
  const r = await call('add_entry', { summary: long, details: 'given', project: 'p' });
  expect(r.isError).toBeFalsy();
  expect(journal.repo.find()[0].details).toBe(`${long}\n\ngiven`);
});

test('new tag gets close-tag hints', async () => {
  await call('add_entry', { summary: 'first', project: 'p', tags: ['review'] });
  const r = await call('add_entry', { summary: 'second', project: 'p', tags: ['reveiw'] });
  expect(text(r)).toContain('New tag "reveiw". Close existing tags: review');
});

test('a new tag with no close match prints no hint', async () => {
  await call('add_entry', { summary: 'first', project: 'p', tags: ['review'] });
  const r = await call('add_entry', { summary: 'second', project: 'p', tags: ['database'] });
  expect(text(r)).not.toContain('New tag');
});

test('resolves closes an open blocker', async () => {
  await call('add_entry', { summary: 'stuck', kind: 'blocker', project: 'p' });
  const blocker = journal.repo.find()[0];
  const r = await call('add_entry', { summary: 'fixed', project: 'p', resolves: [blocker.id.slice(-8)] });
  expect(r.isError).toBeFalsy();
  expect(journal.repo.get(blocker.id)!.status).toBe('resolved');
});

test('resolves with an unknown id still adds the entry and reports it', async () => {
  const r = await call('add_entry', { summary: 'fixed', project: 'p', resolves: ['ZZZZZZZZ'] });
  expect(r.isError).toBeFalsy();
  expect(text(r)).toContain('Could not resolve ZZZZZZZZ: No entry with id');
  expect(journal.repo.find()).toHaveLength(1);
});

test('resolves keeps valid ids and drops a non-open one', async () => {
  const blocker = seed('stuck', { kind: 'blocker', createdAt: '2026-07-13T10:00:00.000Z' });
  const done = seed('finished', { createdAt: '2026-07-13T10:00:01.000Z' });
  const r = await call('add_entry', { summary: 'fixed', project: 'p', resolves: [blocker.id.slice(-8), done.id.slice(-8)] });
  expect(r.isError).toBeFalsy();
  expect(text(r)).toContain(`Could not resolve ${done.id.slice(-8)}: only an open blocker or next can be resolved`);
  expect(journal.repo.get(blocker.id)!.status).toBe('resolved');
});

test('update_entry, delete_entry, resolve_entry work by suffix', async () => {
  const one = seed('one', { createdAt: '2026-07-13T10:00:00.000Z' });
  const blocker = seed('blocked', { kind: 'blocker', createdAt: '2026-07-13T10:00:01.000Z' });

  const u = await call('update_entry', { id: one.id.slice(-8), summary: 'one edited', tags: ['x'] });
  expect(u.isError).toBeFalsy();
  expect(journal.repo.get(one.id)).toMatchObject({ summary: 'one edited', tags: ['x'] });

  const r = await call('resolve_entry', { id: blocker.id.slice(-8), by: one.id.slice(-8) });
  expect(r.isError).toBeFalsy();
  expect(journal.repo.get(blocker.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: one.id });

  const d = await call('delete_entry', { id: one.id.slice(-8) });
  expect(text(d)).toContain(`restore with gournal restore ${one.id.slice(-8)}`);
  expect(journal.repo.get(one.id)!.deletedAt).not.toBeNull();
});

test('update_entry kind change reopens and clears resolution', async () => {
  const blocker = seed('stuck', { kind: 'blocker', createdAt: '2026-07-13T10:00:00.000Z' });
  await call('resolve_entry', { id: blocker.id.slice(-8) });
  expect(journal.repo.get(blocker.id)).toMatchObject({ status: 'resolved' });
  expect(journal.repo.get(blocker.id)!.resolvedAt).not.toBeNull();

  await call('update_entry', { id: blocker.id.slice(-8), kind: 'next' });
  expect(journal.repo.get(blocker.id)).toMatchObject({ kind: 'next', status: 'open', resolvedAt: null, resolvedByEntryId: null });

  await call('update_entry', { id: blocker.id.slice(-8), kind: 'done' });
  expect(journal.repo.get(blocker.id)).toMatchObject({ kind: 'done', status: null, resolvedAt: null });
});

test('update_entry keeps details when only the summary changes', async () => {
  await call('add_entry', { summary: 'one', details: 'keep me', project: 'p' });
  const [e] = journal.repo.find();
  await call('update_entry', { id: e.id.slice(-8), summary: 'two' });
  expect(journal.repo.get(e.id)!.details).toBe('keep me');
});

test('update_entry rejects a long summary without details', async () => {
  await call('add_entry', { summary: 'one', project: 'p' });
  const [e] = journal.repo.find();
  const r = await call('update_entry', { id: e.id.slice(-8), summary: 'x'.repeat(200) });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('max 120');
});

test('update_entry with a long summary plus details is split', async () => {
  const e = seed('one');
  const long = `${'word '.repeat(40)}end.`;
  const r = await call('update_entry', { id: e.id.slice(-8), summary: long, details: 'given' });
  expect(r.isError).toBeFalsy();
  const got = journal.repo.get(e.id)!;
  expect(got.summary.length).toBeLessThanOrEqual(120);
  expect(got.details).toBe(`${long}\n\ngiven`);
});

test('retry matching ignores surrounding whitespace', async () => {
  const long = 'q'.repeat(200);
  await call('add_entry', { summary: `  ${long}  `, project: 'p' });
  const r = await call('add_entry', { summary: long, project: 'p' });
  expect(r.isError).toBeFalsy();
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

test('list_entries returns v2 entries newest first', async () => {
  seed('older', { createdAt: '2026-07-13T10:00:00.000Z' });
  seed('newer', { createdAt: '2026-07-13T10:00:01.000Z' });
  const list = JSON.parse(text(await call('list_entries')));
  expect(list.map((e: any) => e.summary)).toEqual(['newer', 'older']);
  expect(list[0].id).toEqual(expect.any(String));
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

test('list_entries rejects a malformed date', async () => {
  const r = await call('list_entries', { from: 'not-a-date' });
  expect(r.isError).toBe(true);
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

test('get_work_log filters by tags', async () => {
  await call('add_entry', { summary: 'Tagged work', project: 'api', tags: ['bug'] });
  await call('add_entry', { summary: 'Other work', project: 'api' });
  const out = text(await call('get_work_log', { month: true, tags: ['bug'] }));
  expect(out).toContain('Tagged work');
  expect(out).not.toContain('Other work');
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

test('list_tags and list_projects count entries', async () => {
  await call('add_entry', { summary: 'a', project: 'api', tags: ['bug'] });
  await call('add_entry', { summary: 'b', project: 'infra' });
  expect(JSON.parse(text(await call('list_tags')))).toEqual([{ tag: 'bug', count: 1 }]);
  expect(JSON.parse(text(await call('list_projects')))).toEqual(
    expect.arrayContaining([{ project: 'api', count: 1 }, { project: 'infra', count: 1 }])
  );
});

test('without a passed journal the server opens GOURNAL_HOME lazily', async () => {
  const prev = process.env.GOURNAL_HOME;
  process.env.GOURNAL_HOME = home;
  try {
    const lazy = await connect();
    const r = (await lazy.callTool({ name: 'add_entry', arguments: { summary: 'lazy', project: 'p' } })) as any;
    expect(r.isError).toBeFalsy();
    expect(journal.repo.find().map(e => e.summary)).toContain('lazy');
  } finally {
    if (prev === undefined) delete process.env.GOURNAL_HOME; else process.env.GOURNAL_HOME = prev;
  }
});

test('the same target as a full id and as a suffix resolves once and the add succeeds', async () => {
  const blocker = seed('stuck', { kind: 'blocker', createdAt: '2026-07-13T10:00:00.000Z' });
  const r = await call('add_entry', { summary: 'fixed', project: 'p', resolves: [blocker.id, blocker.id.slice(-8)] });
  expect(r.isError).toBeFalsy();
  expect(text(r)).not.toContain('Could not resolve');
  const done = journal.repo.find().find((e) => e.summary === 'fixed')!;
  expect(journal.repo.get(blocker.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: done.id });
});

test('a target that turns non-open before the write is dropped and the add still succeeds', async () => {
  const blocker = seed('stuck', { kind: 'blocker', createdAt: '2026-07-13T10:00:00.000Z' });
  const orig = journal.repo.transaction.bind(journal.repo);
  // Another process resolves the blocker right as the write transaction starts.
  journal.repo.transaction = ((fn: () => unknown) => orig(() => { journal.repo.resolve(blocker.id); return fn(); })) as typeof journal.repo.transaction;
  const r = await call('add_entry', { summary: 'fixed', project: 'p', resolves: [blocker.id.slice(-8)] });
  expect(r.isError).toBeFalsy();
  expect(text(r)).toContain(`Could not resolve ${blocker.id.slice(-8)}: only an open blocker or next can be resolved`);
  expect(journal.repo.find().some((e) => e.summary === 'fixed')).toBe(true);
});

test('a multi-line summary is rejected with the one-line message', async () => {
  const r = await call('add_entry', { summary: 'Line one\nLine two', project: 'p' });
  expect(r.isError).toBe(true);
  expect(text(r)).toBe('summary must be one line, max 120. Put the rest in details.');
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
  for (const n of ['find_entries', 'list_entries', 'get_standup', 'get_work_log', 'list_tags', 'list_projects', 'add_entry', 'update_entry', 'delete_entry', 'resolve_entry'])
    expect(tools.find((t) => t.name === n)?.outputSchema).toBeDefined();
  expect(tools.find((t) => t.name === 'export_entries')?.outputSchema).toBeUndefined();
});

test('write tools return structured entry and notes', async () => {
  const a = await call('add_entry', { summary: 'first', project: 'p' });
  expect(a.structuredContent.entry.summary).toBe('first');
  expect(a.structuredContent.notes).toEqual([]);
  const id = a.structuredContent.entry.id;
  const b = await call('add_entry', { summary: 'second', project: 'p', resolves: ['ZZZZZZZZ'] });
  expect(b.structuredContent.notes[0]).toContain('Could not resolve ZZZZZZZZ');
  const u = await call('update_entry', { id: id.slice(-8), summary: 'first edited' });
  expect(u.structuredContent.entry.summary).toBe('first edited');
  const d = await call('delete_entry', { id: id.slice(-8) });
  expect(d.structuredContent.entry.deletedAt).not.toBeNull();
  seed('blk', { kind: 'blocker' });
  const blk = journal.repo.find({ kind: ['blocker'] })[0];
  const r = await call('resolve_entry', { id: blk.id.slice(-8) });
  expect(r.structuredContent.entry.status).toBe('resolved');
});

test('delete_entry text result says removed and keeps the restore hint', async () => {
  const e = seed('Draft the release notes');
  const id = e.id.slice(-8);
  const r = await call('delete_entry', { id });
  expect(text(r)).toBe(`Entry ${id} removed: Draft the release notes\nrestore with gournal restore ${id}`);
});

test('error results have no structured content', async () => {
  const r = await call('add_entry', { project: 'p' });
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toBeUndefined();
});

test('get_standup returns sections in JSON and markdown', async () => {
  seed('Old blocker', { kind: 'blocker', createdAt: daysAgo(2) });
  seed('Did a thing');
  const r = await call('get_standup');
  expect(r.structuredContent.blockers).toHaveLength(1);
  expect(r.structuredContent.done[0].entries[0].summary).toBe('Did a thing');
  expect(text(r)).toContain('### Blockers');
});

test('get_standup carries an older open blocker forward even with from', async () => {
  seed('Old blocker', { kind: 'blocker', createdAt: daysAgo(3) });
  seed('Did a thing');
  const today = format(new Date(), 'yyyy-MM-dd');
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

test('get_work_log accepts from and to and returns structured days', async () => {
  seed('In range', { createdAt: '2026-07-13T10:00:00.000Z' });
  seed('Out of range', { createdAt: '2026-07-20T10:00:00.000Z' });
  const r = await call('get_work_log', { from: '2026-07-13', to: '2026-07-14' });
  expect(text(r)).toContain('In range');
  expect(text(r)).not.toContain('Out of range');
  expect(r.structuredContent.count).toBe(1);
  expect(r.structuredContent.days[0].entries[0].summary).toBe('In range');
});

test('list_tags and list_projects return structured counts', async () => {
  seed('a', { project: 'api', tags: ['bug'] });
  expect((await call('list_tags')).structuredContent.tags).toEqual([{ tag: 'bug', count: 1 }]);
  expect((await call('list_projects')).structuredContent.projects).toEqual([{ project: 'api', count: 1 }]);
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
});

test('export_entries with exactly the limit shows no notice', async () => {
  for (let i = 1; i <= 200; i++) seed(`Row ${i}`, { createdAt: new Date(Date.UTC(2026, 6, 13, 0, 0, i)).toISOString() });
  const r = await call('export_entries', { format: 'csv' });
  expect(r.content).toHaveLength(1);
  expect(r.content[0].text.split('\n')).toHaveLength(201);
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
  const level = chalk.level;
  afterEach(() => { chalk.level = level; });
  test('no tool output contains ANSI with colour forced on', async () => {
    chalk.level = 3;
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
  for (const name of ['get_standup', 'get_work_log', 'export_entries', 'find_entries']) {
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
    }) as GhRunner & { calls: string[][] };
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

  test('get_standup adds the sync warning as the last markdown line and as syncWarning', async () => {
    delete process.env.GOURNAL_NO_AUTOSYNC;
    seed('Did a thing');
    const c = await connect(journal, { gh: down });
    const r: any = await c.callTool({ name: 'get_standup', arguments: {} });
    const warning = 'gournal: GitHub sync skipped (gh is not signed in; run gh auth login); showing stored activity';
    expect(r.structuredContent.syncWarning).toBe(warning);
    expect(text(r).trimEnd().split('\n').pop()).toBe(warning);
    expect(text(r)).toContain('Did a thing');
  });

  test('get_work_log runs auto-sync and reports the warning', async () => {
    delete process.env.GOURNAL_NO_AUTOSYNC;
    seed('Did a thing');
    const c = await connect(journal, { gh: down });
    const r: any = await c.callTool({ name: 'get_work_log', arguments: {} });
    expect(r.structuredContent.syncWarning).toContain('GitHub sync skipped');
    expect(text(r).trimEnd().split('\n').pop()).toContain('GitHub sync skipped');
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

test('the server lists 12 tools', async () => {
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(12);
  expect(tools.find((t) => t.name === 'sync_activity')?.outputSchema).toBeDefined();
});
