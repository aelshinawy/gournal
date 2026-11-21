import { subDays } from '../../src/core/dates';
import { buildStandup, buildStats, buildWorkLog, resolvePeriod } from '../../src/core';
import { forceColor } from '../../src/render/style';
import {
  entryLinesText, projectCountsText, standupText, statsText, tagCountsText, workLogText,
} from '../../src/render';
import { makeActivity, makeEntry } from '../core/factory';
import type { Activity, StandupModel } from '../../src/core';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const now = new Date(2026, 10, 15, 12, 0, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0);
const standup = (done: ReturnType<typeof makeEntry>[], open: ReturnType<typeof makeEntry>[] = [], opts = {}) =>
  buildStandup({ period: resolvePeriod(opts, now, 1), done, open, now, staleAfterDays: 14 });

describe('terminal renderers', () => {
  beforeEach(() => { forceColor(false); });
  afterEach(() => { forceColor(undefined); });

  const doneEntries = [
    makeEntry({ createdAt: at(15, 9, 5), summary: 'Fixed auth middleware', project: 'api', tags: ['bug'] }),
    makeEntry({ createdAt: at(15, 10, 30), summary: 'Updated Docker config', project: 'infra' }),
  ];

  test('standup with no open items has no Done heading', () => {
    const today = standupText(standup(doneEntries));
    expect(today).toContain('Standup: Today (2026-11-15)');
    expect(today).toContain('  api\n  09:05  Fixed auth middleware\n');
    expect(today).toContain('  infra\n  10:30  Updated Docker config\n');
    expect(today).not.toContain('Done');
    for (const [opts, label] of [[{ week: true }, 'Weekly'], [{ yesterday: true }, 'Yesterday'], [{ month: true }, 'Monthly']] as const) {
      const out = standupText(standup(doneEntries, [], opts));
      expect(out).toContain(`Standup: ${label}`);
      expect(out).toContain('api');
      expect(out).toContain('infra');
    }
  });

  test('multi-day standup uses the day-of-week time format', () => {
    expect(standupText(standup(doneEntries, [], { week: true }))).toContain('Sun 15 - 09:05  Fixed auth middleware');
  });

  test('empty standup', () => {
    forceColor(true);
    expect(standupText(standup([]))).toBe('\u001b[33m\nNo entries found\n\u001b[39m');
  });

  test('stale line uses the singular day word for 1 day', () => {
    const open = [makeEntry({ createdAt: subDays(now, 30), summary: 'Old thing', kind: 'next', status: 'open' })];
    const plain = stripAnsi(standupText(buildStandup({ period: resolvePeriod({}, now, 1), done: [], open, now, staleAfterDays: 1 })));
    expect(plain).toContain('Stale: 1 open item older than 1 day (ids:');
  });

  test('standup adds Done, Blockers, Next, and Stale', () => {
    const open = [
      makeEntry({ createdAt: at(13, 9), summary: 'Stuck on CI', kind: 'blocker', status: 'open' }),
      makeEntry({ createdAt: at(12, 9), summary: 'Write docs', kind: 'next', status: 'open' }),
      makeEntry({ createdAt: subDays(now, 30), summary: 'Old thing', kind: 'next', status: 'open' }),
    ];
    const plain = stripAnsi(standupText(standup(doneEntries, open)));
    expect(plain).toMatch(/Done[\s\S]*Blockers[\s\S]*Next[\s\S]*Stale: 1 open item older than 14 days \(ids: [0-9A-Z]{8}\)/);
    expect(plain).toContain('Nov 13  ');
    expect(plain).toContain('Stuck on CI  [api]');
  });

  test('standup with only open items has no Done heading', () => {
    const open = [makeEntry({ createdAt: at(13, 9), summary: 'Stuck', kind: 'blocker', status: 'open' })];
    const plain = stripAnsi(standupText(standup([], open)));
    expect(plain).toContain('Blockers');
    expect(plain).not.toContain('Done');
  });

  test('work log', () => {
    const log = workLogText(buildWorkLog(resolvePeriod({}, now, 1), doneEntries));
    expect(log).toContain('Work Log: Today');
    expect(log).toContain('Fixed auth middleware');
    expect(log).toContain('[api]');
    expect(log).toContain('[infra]');
    expect(log).toContain('2 entries across 2 projects.');
    expect(log).toContain('Sun Nov 15');
    expect(log).toContain('09:05 ');
  });

  test('work log singular footer, weekly title, and empty', () => {
    expect(workLogText(buildWorkLog(resolvePeriod({}, now, 1), [doneEntries[0]]))).toContain('1 entry across 1 project.');
    expect(workLogText(buildWorkLog(resolvePeriod({ week: true }, now, 1), doneEntries))).toContain('Work Log: Weekly');
    expect(stripAnsi(workLogText(buildWorkLog(resolvePeriod({}, now, 1), [])))).toContain('No entries found');
  });

  test('stats', () => {
    const entries = [
      makeEntry({ createdAt: now, project: 'api', tags: ['bug'] }),
      makeEntry({ createdAt: now, project: 'api', tags: ['bug'] }),
      makeEntry({ createdAt: now, project: 'infra' }),
    ];
    const out = statsText(buildStats(entries, now));
    expect(out).toContain('Total entries: 3');
    expect(out).toContain('api: 2');
    expect(out).toContain('infra: 1');
    expect(out).toContain('#bug: 2');
    expect(out).toContain('Current streak: 1 day\n');
  });

  test('stats streaks and empty', () => {
    const e = (d: Date) => makeEntry({ createdAt: d });
    expect(statsText(buildStats([e(now), e(subDays(now, 1)), e(subDays(now, 2))], now))).toContain('Current streak: 3 days');
    expect(statsText(buildStats([e(subDays(now, 1))], now))).toContain('Current streak: 1 day');
    expect(statsText(buildStats([e(subDays(now, 3))], now))).toContain('Current streak: 0 days');
    expect(statsText(buildStats([], now))).toContain('No entries found');
  });

  test('entry lines, tag counts, project counts', () => {
    const e = makeEntry({ createdAt: at(15, 10, 30), summary: 'Shipped find', project: 'gournal', tags: ['release', 'cli'] });
    expect(entryLinesText([e])).toBe(`Nov Sun 15 - 10:30 ${e.id.slice(-8)} [gournal] Shipped find #release #cli`);
    expect(tagCountsText([{ tag: 'bug', count: 2 }])).toBe('#bug  2');
    expect(tagCountsText([])).toBe('No tags found.');
    expect(projectCountsText([{ project: 'api', count: 3 }, { project: 'x', count: 1 }])).toBe('api  3\nx  1');
    expect(projectCountsText([])).toBe('No projects found.');
  });
});

describe('terminal renderers with activity', () => {
  beforeEach(() => { forceColor(false); });
  afterEach(() => { forceColor(undefined); });

  const entry = makeEntry({ createdAt: at(15, 10, 41), summary: 'Merged gournal PR #4 and installed 0.8.0', project: 'gournal' });
  const mergedPr4 = makeActivity({ type: 'pr_merged', repo: 'acme/gournal', pr: 4, title: 'Phase 2 layers', occurredAt: at(15, 10, 40).toISOString() });
  const commits = [1, 2, 3].map(() => makeActivity({ type: 'commit', repo: 'acme/gournal', occurredAt: at(15, 10, 30).toISOString() }));
  const merged327 = makeActivity({ type: 'pr_merged', repo: 'acme/widgets', pr: 327, title: 'Add widget cache', occurredAt: at(15, 9, 0).toISOString() });
  const reviewed412 = makeActivity({ type: 'review', repo: 'octo/app', pr: 412, title: 'Fix login redirect', occurredAt: at(15, 8, 0).toISOString() });
  const model = (unlinked: Activity[], linked: Record<string, Activity[]> = {}, opts = {}) =>
    buildStandup({ period: resolvePeriod(opts, now, 1), done: [entry], open: [], now, staleAfterDays: 14, linked, unlinked });

  test('no activity looks as before', () => {
    const phase2 = standupText(standup([entry]));
    const m = { ...standup([entry]), linked: {}, also: null } satisfies StandupModel;
    expect(standupText(m)).toBe(phase2);
    expect(standupText(m, { expandActivity: true })).toBe(phase2);
    const log = buildWorkLog(resolvePeriod({}, now, 1), [entry]);
    expect(workLogText({ ...log, linked: {} })).toBe(workLogText(log));
  });

  test('linked activity folds under its entry', () => {
    const out = standupText(model([], { [entry.id]: [mergedPr4, ...commits] }));
    expect(out).toBe(
      '\nStandup: Today (2026-11-15)\n\n  gournal\n  10:41  Merged gournal PR #4 and installed 0.8.0\n' +
      '         \u21b3 merged #4 Phase 2 layers\n         \u21b3 3 commits\n');
  });

  test('a single linked commit uses the singular form', () => {
    expect(standupText(model([], { [entry.id]: [commits[0]] }))).toContain('         \u21b3 1 commit\n');
  });

  test('collapsed Also line lists merged PRs and reviews by title', () => {
    const out = standupText(model([reviewed412, merged327]));
    expect(out).toBe(
      '\nStandup: Today (2026-11-15)\n\n  Done\n  gournal\n  10:41  Merged gournal PR #4 and installed 0.8.0\n\n' +
      '  Also: 1 PR merged, 1 review in 2 repos (--activity to expand)\n' +
      '    merged    acme/widgets#327  Add widget cache\n' +
      '    reviewed  octo/app#412      Fix login redirect\n');
  });

  test('the Also line matches the brief counts and leaves out zero counts', () => {
    const many = [
      ...Array.from({ length: 15 }, (_, i) => makeActivity({ type: 'commit', repo: ['acme/widgets', 'octo/app', 'acme/gears'][i % 3] })),
      makeActivity({ type: 'pr_opened', repo: 'acme/widgets', pr: 1 }),
      makeActivity({ type: 'pr_merged', repo: 'acme/widgets', pr: 327 }), makeActivity({ type: 'pr_merged', repo: 'acme/widgets', pr: 328 }),
      ...[1, 2, 3, 4].map((n) => makeActivity({ type: 'review', repo: 'octo/app', pr: n })),
    ];
    expect(stripAnsi(standupText(model(many)))).toContain('  Also: 15 commits, 1 PR opened, 2 PRs merged, 4 reviews in 3 repos (--activity to expand)\n');
    expect(standupText(model([commits[0]]))).toContain('  Also: 1 commit in 1 repo (--activity to expand)\n');
    expect(standupText(model([merged327]))).toContain('  Also: 1 PR merged in 1 repo (--activity to expand)\n');
    expect(standupText(model([makeActivity({ type: 'pr_opened', pr: 2, repo: 'a/b' })]))).toContain('  Also: 1 PR opened in 1 repo');
    expect(standupText(model([reviewed412]))).toContain('  Also: 1 review in 1 repo');
  });

  test('--activity expands the full list grouped by repo', () => {
    const c = makeActivity({ type: 'commit', repo: 'acme/widgets', externalId: 'abcdef0123456789', title: 'Fix cache key', occurredAt: at(15, 7, 5).toISOString() });
    const opened = makeActivity({ type: 'pr_opened', repo: 'acme/widgets', pr: 327, title: 'Add widget cache', occurredAt: at(15, 8, 30).toISOString() });
    const out = standupText(model([reviewed412, merged327, opened, c]), { expandActivity: true });
    expect(out).toBe(
      '\nStandup: Today (2026-11-15)\n\n  Done\n  gournal\n  10:41  Merged gournal PR #4 and installed 0.8.0\n\n' +
      '  Also happened\n' +
      '  acme/widgets\n' +
      '    07:05  commit    abcdef0  Fix cache key\n' +
      '    08:30  opened    #327     Add widget cache\n' +
      '    09:00  merged    #327     Add widget cache\n' +
      '  octo/app\n' +
      '    08:00  reviewed  #412     Fix login redirect\n');
    expect(out).not.toContain('--activity to expand');
  });

  test('Also renders last, after Blockers, Next, and the Stale line', () => {
    const old = makeEntry({ kind: 'next', status: 'open', createdAt: subDays(now, 30), summary: 'Old next' });
    const blocker = makeEntry({ kind: 'blocker', status: 'open', createdAt: at(14, 9), summary: 'A blocker' });
    const next = makeEntry({ kind: 'next', status: 'open', createdAt: at(14, 10), summary: 'A next' });
    const m = buildStandup({ period: resolvePeriod({}, now, 1), done: [entry], open: [old, blocker, next], now, staleAfterDays: 14, unlinked: [merged327] });
    const out = standupText(m);
    const at_ = (t: string) => out.indexOf(t);
    expect(at_('Blockers')).toBeGreaterThan(at_('Done'));
    expect(at_('Stale:')).toBeGreaterThan(at_('Next'));
    expect(at_('  Also:')).toBeGreaterThan(at_('Stale:'));
  });

  test('multi-day ranges use the day-of-week time on activity lines', () => {
    const out = standupText(model([merged327], {}, { week: true }), { expandActivity: true });
    expect(out).toContain('    Sun 15 09:00  merged  #327  Add widget cache\n');
  });

  test('a standup with only unlinked activity still renders', () => {
    const m = buildStandup({ period: resolvePeriod({}, now, 1), done: [], open: [], now, staleAfterDays: 14, unlinked: [merged327] });
    expect(standupText(m)).toContain('  Also: 1 PR merged in 1 repo (--activity to expand)');
    expect(standupText(m)).not.toContain('No entries found');
  });

  test('Also lines are gray when color is on', () => {
    forceColor(true);
    expect(standupText(model([merged327]))).toContain('\u001b[90m  Also: 1 PR merged in 1 repo (--activity to expand)\u001b[39m');
  });

  test('work log folds linked activity under its entry', () => {
    const log = buildWorkLog(resolvePeriod({}, now, 1), [entry], { [entry.id]: [mergedPr4, ...commits] });
    const out = workLogText(log);
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.includes('Merged gournal PR #4'));
    expect(lines[i + 1].trimStart()).toBe('\u21b3 merged #4 Phase 2 layers');
    expect(lines[i + 2].trimStart()).toBe('\u21b3 3 commits');
    expect(out).not.toContain('Also');
  });
});

describe('terminal renderers strip control characters', () => {
  beforeEach(() => { forceColor(false); });
  afterEach(() => { forceColor(undefined); });

  const HOSTILE = 'esc \x1b]0;PWNED\x07 \x1b[2J\x1b[31mred \x9b31m \x85 \x7f end';
  // Tab and newline are legal in output as layout. Every other C0 control, DEL, and every C1 control are not.
  const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
  const noControl = (s: string) => expect(BAD.test(s)).toBe(false);

  const bad = makeEntry({ createdAt: at(15, 9, 0), summary: HOSTILE, project: `pr${HOSTILE}`, tags: [`t${HOSTILE}`] });
  const blocker = makeEntry({ createdAt: at(14, 9, 0), kind: 'blocker', status: 'open', summary: HOSTILE, project: `pr${HOSTILE}` });
  const pr = makeActivity({ type: 'pr_merged', repo: `acme/${HOSTILE}`, pr: 4, title: `title ${HOSTILE}`, occurredAt: at(15, 8, 0).toISOString() });
  const rev = makeActivity({ type: 'review', repo: 'octo/app', pr: 9, title: HOSTILE, occurredAt: at(15, 8, 30).toISOString() });
  const commit = makeActivity({ type: 'commit', repo: 'acme/widgets', externalId: `ab\x1b[2Jcdef0123`, title: HOSTILE, occurredAt: at(15, 7, 0).toISOString() });
  const std = (linked: Record<string, Activity[]>, unlinked: Activity[]) =>
    buildStandup({ period: resolvePeriod({}, now, 1), done: [bad], open: [blocker], now, staleAfterDays: 14, linked, unlinked });

  test('standup: entries, open items, PR titles, repos, and refs', () => {
    const m = std({ [bad.id]: [pr] }, [rev, commit]);
    for (const out of [standupText(m), standupText(m, { expandActivity: true })]) {
      noControl(out);
      expect(out).toContain('esc ]0;PWNED');
    }
  });

  test('work log, stats, find lines, tag counts, and project counts', () => {
    const log = buildWorkLog(resolvePeriod({}, now, 1), [bad], { [bad.id]: [pr] });
    noControl(workLogText(log));
    noControl(statsText(buildStats([bad], now)));
    noControl(entryLinesText([bad]));
    noControl(tagCountsText([{ tag: `t${HOSTILE}`, count: 1 }]));
    noControl(projectCountsText([{ project: `p${HOSTILE}`, count: 1 }]));
  });

  test('color escape codes survive when color is on, and user escapes do not', () => {
    forceColor(true);
    const out = entryLinesText([bad]);
    expect(out).toContain('\x1b[34m');
    expect(out).not.toContain('\x1b]0;PWNED');
    expect(out).not.toContain('\x1b[2J');
    expect(out.replace(/\x1b\[[0-9;]*m/g, '')).not.toContain('\x1b');
  });
});
