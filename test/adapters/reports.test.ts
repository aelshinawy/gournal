import fs from 'fs';
import os from 'os';
import path from 'path';
import { openJournal, type Journal } from '../../src/storage/journal';
import { standupModel } from '../../src/adapters/reports';
import type { NewActivityInput } from '../../src/core';
import { rmTmp } from '../helpers/tmp';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const TODAY = '2026-11-15T09:00:00.000Z';
const YESTERDAY = '2026-11-14T09:00:00.000Z';

let home: string;
let journal: Journal;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-reports-'));
  journal = openJournal(home);
});
afterEach(() => {
  journal.close();
  rmTmp(home);
});

const act = (over: Partial<NewActivityInput>): NewActivityInput => ({
  type: 'pr_merged', occurredAt: TODAY, repo: 'acme/widgets', branch: null, externalId: '5',
  title: 'PR five', url: null, pr: 5, payload: {}, ...over,
});
const entry = (over: Record<string, unknown>) => journal.repo.add({ summary: 'work', project: 'p', source: 'cli', ...over } as never);
const also = (m: ReturnType<typeof standupModel>) => (m.also?.activity ?? []).map((a) => `${a.type}:${a.pr}`);

test('activity linked only to a next entry shows in Also', () => {
  const next = entry({ summary: 'review PR 5', kind: 'next', refs: [{ type: 'pr', value: '5' }], createdAt: YESTERDAY });
  const up = journal.activity.upsert([act({ type: 'review', externalId: '9001' })]);
  journal.activity.relinkActivity(up.ids);
  expect(journal.activity.linkedTo([next.id])[next.id]).toHaveLength(1);
  expect(also(standupModel(journal, {}, NOW))).toEqual(['review:5']);
});

test('activity linked to an earlier day entry shows in Also', () => {
  const old = entry({ summary: 'opened PR #5', kind: 'done', refs: [{ type: 'pr', value: '5' }], createdAt: YESTERDAY });
  const up = journal.activity.upsert([act({})]);
  journal.activity.relinkActivity(up.ids);
  expect(journal.activity.linkedTo([old.id])[old.id]).toHaveLength(1);
  const m = standupModel(journal, {}, NOW);
  expect(m.done).toHaveLength(0);
  expect(also(m)).toEqual(['pr_merged:5']);
});

test('activity linked to a done entry shown today is folded and not in Also', () => {
  const done = entry({ summary: 'merged PR 5', kind: 'done', refs: [{ type: 'pr', value: '5' }], createdAt: TODAY });
  const up = journal.activity.upsert([act({})]);
  journal.activity.relinkActivity(up.ids);
  const m = standupModel(journal, {}, NOW);
  expect(m.linked[done.id]).toHaveLength(1);
  expect(m.also).toBeNull();
});

test('deleting a linked done entry shows its activity in Also, and restoring folds it again without a relink', () => {
  const done = entry({ summary: 'merged PR 5', kind: 'done', refs: [{ type: 'pr', value: '5' }], createdAt: TODAY });
  const up = journal.activity.upsert([act({})]);
  journal.activity.relinkActivity(up.ids);
  expect(standupModel(journal, {}, NOW).also).toBeNull();
  journal.repo.softDelete(done.id);
  expect(also(standupModel(journal, {}, NOW))).toEqual(['pr_merged:5']);
  expect(journal.activity.linkedTo([done.id])).toEqual({});
  expect(journal.activity.find({ linked: true })).toHaveLength(0);
  journal.repo.restore(done.id);
  const m = standupModel(journal, {}, NOW);
  expect(m.also).toBeNull();
  expect(m.linked[done.id]).toHaveLength(1);
  expect(journal.activity.find({ linked: true })).toHaveLength(1);
});
