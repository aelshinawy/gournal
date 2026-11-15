import fs from 'fs';
import os from 'os';
import path from 'path';
import { openJournal } from '../../src/storage/journal';
import type { Journal } from '../../src/storage/journal';
import type { NewActivityInput } from '../../src/core';

let home: string;
let journal: Journal;
let other: Journal;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-activity-'));
  journal = openJournal(home);
  other = openJournal(home);
});
afterEach(() => {
  jest.restoreAllMocks();
  journal.close();
  other.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const REPO = 'acme/widgets';
const item = (over: Partial<NewActivityInput> = {}): NewActivityInput => ({
  type: 'pr_opened', occurredAt: '2026-11-10T10:00:00.000Z', repo: REPO, branch: 'feat/x', externalId: '5',
  title: 'Add x', url: 'https://github.com/acme/widgets/pull/5', pr: 5, payload: { state: 'open' }, ...over,
});
const commit = (sha: string, over: Partial<NewActivityInput> = {}): NewActivityInput =>
  item({ type: 'commit', externalId: sha, pr: null, title: `commit ${sha.slice(0, 7)}`, branch: null, ...over });
const base = { project: 'p', source: 'cli' as const };
const liveLinks = () => journal.db.prepare('SELECT * FROM links WHERE deleted_at IS NULL').all();
const allLinks = () => journal.db.prepare('SELECT * FROM links').all();

test('upsert twice makes no duplicates and keeps id and createdAt', () => {
  const first = journal.activity.upsert([item()]);
  const created = journal.activity.find()[0].createdAt;
  const second = journal.activity.upsert([item()]);
  expect(first).toMatchObject({ inserted: 1, updated: 0 });
  expect(second).toMatchObject({ inserted: 0, updated: 0 });
  expect(second.ids).toEqual(first.ids);
  const rows = journal.activity.find();
  expect(rows).toHaveLength(1);
  expect(rows[0].createdAt).toBe(created);
  expect(rows[0].id).toBe(first.ids[0]);
  expect(rows[0]).toMatchObject({ capturedBy: 'github', pr: 5, repo: REPO, type: 'pr_opened', payload: { state: 'open', pr: 5 } });
  expect(rows[0].deviceId).toBe(journal.config.deviceId);
});

test('an unchanged upsert does not bump updatedAt', () => {
  journal.activity.upsert([item()]);
  const before = journal.activity.find()[0].updatedAt;
  journal.activity.upsert([item()]);
  expect(journal.activity.find()[0].updatedAt).toBe(before);
});

test('upsert updates a changed title and bumps updatedAt', () => {
  const first = journal.activity.upsert([item()]);
  const before = journal.activity.find()[0];
  const second = journal.activity.upsert([item({ title: 'Add x v2' })]);
  expect(second).toMatchObject({ inserted: 0, updated: 1, ids: first.ids });
  const after = journal.activity.find()[0];
  expect(after.title).toBe('Add x v2');
  expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
  expect(after.createdAt).toBe(before.createdAt);
});

test('find filters by from, to, repo case-insensitively, types, and linked false', () => {
  journal.activity.upsert([
    item({ externalId: '1', occurredAt: '2026-11-01T10:00:00.000Z', pr: 1 }),
    item({ type: 'review', externalId: 'r1', occurredAt: '2026-11-05T10:00:00.000Z', pr: 2, repo: 'Octo/Gadgets', branch: null }),
    commit('a'.repeat(40), { occurredAt: '2026-11-09T10:00:00.000Z' }),
  ]);
  expect(journal.activity.find().map((a) => a.occurredAt)).toEqual([
    '2026-11-01T10:00:00.000Z', '2026-11-05T10:00:00.000Z', '2026-11-09T10:00:00.000Z']);
  expect(journal.activity.find({ from: '2026-11-05T10:00:00.000Z' })).toHaveLength(2);
  expect(journal.activity.find({ to: '2026-11-05T10:00:00.000Z' })).toHaveLength(2);
  expect(journal.activity.find({ repo: 'octo/gadgets' })).toHaveLength(1);
  expect(journal.activity.find({ types: ['commit', 'review'] })).toHaveLength(2);
  const e = journal.repo.add({ summary: 'did 1', refs: [{ type: 'pr', value: '1', repo: REPO }], ...base });
  expect(journal.activity.relinkEntries([e.id])).toBe(1);
  expect(journal.activity.find({ linked: false })).toHaveLength(2);
});

test('relinkEntries adds links and is idempotent', () => {
  journal.activity.upsert([item(), item({ type: 'pr_merged', externalId: '5m', occurredAt: '2026-11-11T10:00:00.000Z' })]);
  const e = journal.repo.add({ summary: 'ship x', refs: [{ type: 'pr', value: '5', repo: REPO }], ...base });
  expect(journal.activity.relinkEntries([e.id])).toBe(2);
  expect(journal.activity.relinkEntries([e.id])).toBe(0);
  expect(liveLinks()).toHaveLength(2);
  expect(allLinks()).toHaveLength(2);
  expect(liveLinks()[0]).toMatchObject({ reason: 'pr-match', device_id: journal.config.deviceId });
});

test('relinkEntries matches a repo case-insensitively', () => {
  journal.activity.upsert([item()]);
  const e = journal.repo.add({ summary: 'ship x', refs: [{ type: 'pr', value: '5', repo: 'ACME/Widgets' }], ...base });
  expect(journal.activity.relinkEntries([e.id])).toBe(1);
});

test('relinkEntries matches a commit sha prefix', () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  journal.activity.upsert([commit(sha), commit('1234567' + '0'.repeat(33))]);
  const e = journal.repo.add({ summary: 'fix', refs: [{ type: 'commit', value: 'ABCDEF1' }], ...base });
  expect(journal.activity.relinkEntries([e.id])).toBe(1);
  expect(liveLinks()[0]).toMatchObject({ reason: 'sha-match' });
});

test('relinkEntries links by branch window and leaves an ambiguous pair alone', () => {
  journal.activity.upsert([item({ type: 'commit', externalId: 'c'.repeat(40), pr: null, occurredAt: '2026-11-10T10:00:00.000Z' })]);
  const a = journal.repo.add({ summary: 'a', kind: 'done', repo: REPO, branch: 'feat/x', createdAt: '2026-11-10T10:30:00.000Z', ...base });
  expect(journal.activity.relinkEntries([a.id])).toBe(1);
  // A second done entry in the window makes the match ambiguous. Relinking only `a` must not add it,
  // and it removes the link that is no longer clear.
  const b = journal.repo.add({ summary: 'b', kind: 'done', repo: REPO, branch: 'feat/x', createdAt: '2026-11-10T10:40:00.000Z', ...base });
  expect(journal.activity.relinkEntries([b.id])).toBe(0);
  expect(journal.activity.relinkEntries([a.id])).toBe(0);
  expect(liveLinks()).toHaveLength(0);
});

test('relinkEntries soft-deletes a link whose ref was removed', () => {
  journal.activity.upsert([item()]);
  const e = journal.repo.add({ summary: 'ship x', refs: [{ type: 'pr', value: '5', repo: REPO }], ...base });
  journal.activity.relinkEntries([e.id]);
  expect(Object.keys(journal.activity.linkedTo([e.id]))).toEqual([e.id]);
  journal.repo.update(e.id, { refs: [] });
  expect(journal.activity.relinkEntries([e.id])).toBe(0);
  expect(journal.activity.linkedTo([e.id])).toEqual({});
  expect(liveLinks()).toHaveLength(0);
  expect(allLinks()).toHaveLength(1);
});

test('relinkActivity links an older entry with a pr ref', () => {
  const e = journal.repo.add({ summary: 'old work', refs: [{ type: 'pr', value: '5', repo: REPO }], createdAt: '2026-10-01T10:00:00.000Z', ...base });
  const { ids } = journal.activity.upsert([item()]);
  expect(journal.activity.relinkActivity(ids)).toBe(1);
  expect(journal.activity.relinkActivity(ids)).toBe(0);
  expect(journal.activity.linkedTo([e.id])[e.id].map((a) => a.id)).toEqual(ids);
});

test('relinkActivity and relinkEntries never duplicate a link', () => {
  const e = journal.repo.add({ summary: 'x', refs: [{ type: 'pr', value: '5', repo: REPO }], ...base });
  const { ids } = journal.activity.upsert([item()]);
  expect(journal.activity.relinkEntries([e.id])).toBe(1);
  expect(journal.activity.relinkActivity(ids)).toBe(0);
  expect(allLinks()).toHaveLength(1);
});

test('relinkActivity keeps an ambiguous sha unlinked', () => {
  journal.repo.add({ summary: 'fix', refs: [{ type: 'commit', value: 'abcdef1', repo: REPO }], ...base });
  const first = journal.activity.upsert([commit('abcdef1' + '0'.repeat(33))]);
  expect(journal.activity.relinkActivity(first.ids)).toBe(1);
  const second = journal.activity.upsert([commit('abcdef1' + '9'.repeat(33))]);
  expect(journal.activity.relinkActivity(second.ids)).toBe(0);
});

test('linkedTo returns activity grouped by entry, oldest first', () => {
  const { ids } = journal.activity.upsert([
    item({ type: 'pr_merged', externalId: '5m', occurredAt: '2026-11-12T10:00:00.000Z' }),
    item(),
  ]);
  const e = journal.repo.add({ summary: 'ship x', refs: [{ type: 'pr', value: '5', repo: REPO }], ...base });
  const f = journal.repo.add({ summary: 'also x', refs: [{ type: 'pr', value: '#5', repo: REPO }], ...base });
  journal.activity.relinkActivity(ids);
  const got = journal.activity.linkedTo([e.id, f.id]);
  expect(got[e.id].map((a) => a.type)).toEqual(['pr_opened', 'pr_merged']);
  expect(got[f.id]).toHaveLength(2);
});

test('tryLease lets one owner hold the lease until it expires', () => {
  expect(journal.activity.tryLease('github.sync', 'a', 120_000)).toBe(true);
  expect(other.activity.tryLease('github.sync', 'b', 120_000)).toBe(false);
  expect(journal.activity.tryLease('github.sync', 'a', 120_000)).toBe(true);
  journal.activity.releaseLease('github.sync', 'a');
  expect(other.activity.tryLease('github.sync', 'b', 120_000)).toBe(true);
});

test('tryLease takes an expired lease and releaseLease ignores a non-owner', () => {
  const now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
  expect(journal.activity.tryLease('github.sync', 'a', 1_000)).toBe(true);
  other.activity.releaseLease('github.sync', 'b');
  expect(other.activity.tryLease('github.sync', 'b', 1_000)).toBe(false);
  spy.mockReturnValue(now + 1_000);
  expect(other.activity.tryLease('github.sync', 'b', 1_000)).toBe(true);
  expect(journal.activity.tryLease('github.sync', 'a', 1_000)).toBe(false);
});
