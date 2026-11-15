// Fill a temp gournal home with demo data for the VHS recordings.
// Usage: node -r ts-node/register/transpile-only scripts/demo/fixture.ts <dir>
// The data is synthetic. The owners `acme` and `octo` are fake.
// GitHub activity goes in through the storage layer. No gh call runs.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openJournal } from '../../src/storage';
import type { NewActivityInput } from '../../src/core';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: fixture.ts <dir>\n');
  process.exit(2);
}
const home = path.resolve(dir);
const realHome = os.userInfo().homedir;
if (home === path.join(realHome, '.gournal') || home === realHome) {
  process.stderr.write(`fixture: refusing to write to ${home}\n`);
  process.exit(2);
}
if (fs.existsSync(path.join(home, 'gournal.db'))) {
  process.stderr.write(`fixture: ${home} already has a journal\n`);
  process.exit(2);
}

// A standup covers the start of today until now. Every time below must fall in that window.
// Clock times read naturally after 17:00. Earlier in the day they scale into the time that has passed.
const now = new Date();
const dayStart = new Date(now);
dayStart.setHours(0, 0, 0, 0);
const latest = 17 * 60;
const minutesNow = (now.getTime() - dayStart.getTime()) / 60_000 - 1;
const at = (hh: number, mm: number): string => {
  const wanted = hh * 60 + mm;
  const minutes = minutesNow >= latest ? wanted : Math.floor((wanted / latest) * minutesNow);
  return new Date(dayStart.getTime() + minutes * 60_000).toISOString();
};
const daysAgo = (n: number, hh: number, mm: number): string => {
  const d = new Date(dayStart);
  d.setDate(d.getDate() - n);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(
  path.join(home, 'config.json'),
  JSON.stringify({ github: { owners: { include: ['acme', 'octo'], exclude: [] } } }, null, 2) + '\n',
);

const journal = openJournal(home);
try {
  const { repo, activity } = journal;
  const api = { project: 'api', repo: 'acme/api', branch: 'fix/token-refresh' };
  const worker = { project: 'worker', repo: 'acme/worker', branch: 'feat/webhook-retry' };

  const ids: string[] = [];
  ids.push(repo.add({ ...api, summary: 'Fixed the token refresh race', source: 'cli', tags: ['auth', 'bug'],
    refs: [{ type: 'pr', value: '412' }], createdAt: at(10, 42) }).id);
  ids.push(repo.add({ ...worker, summary: 'Added retry with backoff to webhooks', source: 'mcp', agent: 'claude-code',
    tags: ['webhooks'], createdAt: at(14, 5) }).id);
  ids.push(repo.add({ ...worker, summary: 'Wrote tests for the retry policy', source: 'mcp', agent: 'claude-code',
    tags: ['webhooks', 'testing'], createdAt: at(16, 10) }).id);
  repo.add({ project: 'api', repo: 'acme/api', summary: 'Waiting on staging keys', kind: 'blocker', source: 'cli',
    createdAt: daysAgo(1, 16, 20) });
  repo.add({ ...worker, summary: 'Ship retry metrics', kind: 'next', source: 'mcp', agent: 'claude-code',
    createdAt: at(16, 30) });

  const url = (r: string, kind: string, id: string | number): string => `https://github.com/${r}/${kind}/${id}`;
  const commit = (r: string, branch: string, sha: string, msg: string, when: string, pr: number | null): NewActivityInput => ({
    type: 'commit', occurredAt: when, repo: r, branch, externalId: sha, title: msg, url: url(r, 'commit', sha), pr, payload: {},
  });
  const items: NewActivityInput[] = [
    // PR 412 links to the first entry by its PR ref.
    { type: 'pr_opened', occurredAt: at(9, 30), repo: 'acme/api', branch: api.branch, externalId: '412',
      title: 'Fix token refresh race', url: url('acme/api', 'pull', 412), pr: 412, payload: {} },
    commit('acme/api', api.branch, 'a41c9e2f0b7d3c18e5a6f0912b3c4d5e6f708192', 'Lock refresh per session', at(9, 55), 412),
    commit('acme/api', api.branch, 'b83d1a7c2e9f40165b7a8c3d2e1f0a9b8c7d6e5f', 'Add refresh race test', at(10, 20), 412),
    commit('acme/api', api.branch, 'c5e2f8a1d3b7094c6e5f4a3b2c1d0e9f8a7b6c5d', 'Retry once on 401', at(10, 35), 412),
    { type: 'pr_merged', occurredAt: at(11, 10), repo: 'acme/api', branch: api.branch, externalId: '412',
      title: 'Fix token refresh race', url: url('acme/api', 'pull', 412), pr: 412, payload: {} },
    // Branch commits within two hours of the webhook entries link by branch and time.
    commit('acme/worker', worker.branch, 'd1f0e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2', 'Add exponential backoff', at(13, 40), null),
    commit('acme/worker', worker.branch, 'e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3', 'Cap retries at five', at(13, 58), null),
    // Unlinked activity goes to the Also section.
    { type: 'review', occurredAt: at(12, 15), repo: 'octo/web', branch: null, externalId: '9001',
      title: 'Dark mode tokens', url: url('octo/web', 'pull', 88), pr: 88, payload: { state: 'APPROVED' } },
    { type: 'pr_merged', occurredAt: at(16, 2), repo: 'acme/docs', branch: 'docs/webhooks', externalId: '57',
      title: 'Document webhook retries', url: url('acme/docs', 'pull', 57), pr: 57, payload: {} },
    commit('acme/docs', 'docs/webhooks', 'f3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4', 'Webhook retry page', at(15, 50), 57),
  ];
  activity.upsert(items);
  activity.relinkEntries(ids);
} finally {
  journal.close();
}
process.stdout.write(`fixture: wrote demo journal to ${home}\n`);
