import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

jest.mock('../src/git');

import { getProjectName } from '../src/git';
import { createServer, SERVER_INSTRUCTIONS } from '../src/mcp';
import { openJournal, type Journal } from '../src/storage/journal';

const mockedGetProjectName = getProjectName as jest.MockedFunction<typeof getProjectName>;

let home: string;
let journal: Journal;
let client: Client;

const text = (r: any): string => r.content[0].text;
const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<any>;

async function connect(j?: Journal) {
  const server = createServer(j);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  return c;
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-mcp-'));
  journal = openJournal(home);
  client = await connect(journal);
  mockedGetProjectName.mockReset();
});
afterEach(() => {
  journal.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('server sends the instructions', () => expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS));

test('server reports the package version', () => {
  expect(client.getServerVersion()?.version).toBe(require('../package.json').version);
});

test('add_entry stores summary, details, kind, refs', async () => {
  const r = await call('add_entry', {
    summary: 'Shipped the thing', details: 'More text', kind: 'next', project: 'gournal',
    tags: ['feature'], refs: [{ type: 'pr', value: '12' }], agent: 'claude',
  });
  expect(r.isError).toBeFalsy();
  const [e] = journal.repo.list();
  expect(e).toMatchObject({ summary: 'Shipped the thing', details: 'More text', kind: 'next', project: 'gournal', tags: ['feature'], source: 'mcp', agent: 'claude' });
  expect(e.refs).toEqual([{ type: 'pr', value: '12' }]);
  expect(text(r).split('\n')[0]).toBe(`Entry ${e.id.slice(-8)} added to gournal: Shipped the thing`);
});

test('message alias still works', async () => {
  await call('add_entry', { message: 'Old style', project: 'p' });
  expect(journal.repo.list()[0].summary).toBe('Old style');
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

test('add_entry falls back to git-detected project when omitted', async () => {
  mockedGetProjectName.mockReturnValue('detected-project');
  await call('add_entry', { summary: 'No project passed' });
  expect(journal.repo.list()[0].project).toBe('detected-project');
});

test('long summary is rejected with the fix', async () => {
  const r = await call('add_entry', { summary: 'x'.repeat(200), project: 'p' });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('max 120');
  expect(journal.repo.list()).toHaveLength(0);
});

test('retry of a rejected summary is split, not rejected', async () => {
  const long = `${'word '.repeat(40)}end.`;
  expect((await call('add_entry', { summary: long, project: 'p' })).isError).toBe(true);
  const r = await call('add_entry', { summary: long, project: 'p' });
  expect(r.isError).toBeFalsy();
  expect(text(r)).toContain('Summary was too long and was split; full text is in details.');
  const [e] = journal.repo.list();
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
  expect(journal.repo.list()[0].details).toBe(`${long}\n\ngiven`);
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
  const blocker = journal.repo.list()[0];
  const r = await call('add_entry', { summary: 'fixed', project: 'p', resolves: [blocker.id.slice(-8)] });
  expect(r.isError).toBeFalsy();
  expect(journal.repo.get(blocker.id)!.status).toBe('resolved');
});

test('resolves with an unknown id is a tool error and adds nothing', async () => {
  const r = await call('add_entry', { summary: 'fixed', project: 'p', resolves: ['ZZZZZZZZ'] });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('No entry with id');
  expect(journal.repo.list()).toHaveLength(0);
});

test('update_entry, delete_entry, resolve_entry work by suffix', async () => {
  await call('add_entry', { summary: 'one', project: 'p' });
  await call('add_entry', { summary: 'blocked', kind: 'blocker', project: 'p' });
  const [one, blocker] = journal.repo.list();

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

test('update_entry keeps details when only the summary changes', async () => {
  await call('add_entry', { summary: 'one', details: 'keep me', project: 'p' });
  const [e] = journal.repo.list();
  await call('update_entry', { id: e.id.slice(-8), summary: 'two' });
  expect(journal.repo.get(e.id)!.details).toBe('keep me');
});

test('update_entry rejects a long summary without details', async () => {
  await call('add_entry', { summary: 'one', project: 'p' });
  const [e] = journal.repo.list();
  const r = await call('update_entry', { id: e.id.slice(-8), summary: 'x'.repeat(200) });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('max 120');
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
  const r = await call('resolve_entry', { id: journal.repo.list()[0].id.slice(-8) });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('only an open blocker or next');
});

test('list_entries returns v2 entries newest first', async () => {
  await call('add_entry', { summary: 'older', project: 'p' });
  await call('add_entry', { summary: 'newer', project: 'p' });
  const list = JSON.parse(text(await call('list_entries')));
  expect(list.map((e: any) => e.summary)).toEqual(['newer', 'older']);
  expect(list[0].id).toEqual(expect.any(String));
});

test('list_entries respects limit and project filter', async () => {
  await call('add_entry', { summary: 'a', project: 'api' });
  await call('add_entry', { summary: 'b', project: 'infra' });
  await call('add_entry', { summary: 'c', project: 'api' });
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
    expect(journal.repo.list().map(e => e.summary)).toContain('lazy');
  } finally {
    if (prev === undefined) delete process.env.GOURNAL_HOME; else process.env.GOURNAL_HOME = prev;
  }
});
