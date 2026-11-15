import chalk from 'chalk';
import { subDays } from 'date-fns';
import { buildStandup, buildStats, buildWorkLog, resolvePeriod } from '../../src/core';
import {
  entryLinesText, projectCountsText, standupText, statsText, tagCountsText, workLogText,
} from '../../src/render';
import { makeEntry } from '../core/factory';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const now = new Date(2026, 10, 15, 12, 0, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0);
const standup = (done: ReturnType<typeof makeEntry>[], open: ReturnType<typeof makeEntry>[] = [], opts = {}) =>
  buildStandup({ period: resolvePeriod(opts, now, 1), done, open, now, staleAfterDays: 14 });

describe('terminal renderers', () => {
  let level: typeof chalk.level;
  beforeEach(() => { level = chalk.level; chalk.level = 0; });
  afterEach(() => { chalk.level = level; });

  const doneEntries = [
    makeEntry({ createdAt: at(15, 9, 5), summary: 'Fixed auth middleware', project: 'api', tags: ['bug'] }),
    makeEntry({ createdAt: at(15, 10, 30), summary: 'Updated Docker config', project: 'infra' }),
  ];

  test('standup with no open items has no Done heading', () => {
    expect(standupText(standup(doneEntries))).toBe(
      '\nStandup: Today (2026-11-15)\n\n  api\n  09:05  Fixed auth middleware\n\n  infra\n  10:30  Updated Docker config\n');
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
    chalk.level = 3;
    expect(standupText(standup([]))).toBe(chalk.yellow('\nNo entries found\n'));
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

  test('terminal output carries ANSI codes when color is on', () => {
    chalk.level = 3;
    expect(standupText(standup(doneEntries))).toContain('\x1b');
    expect(statsText(buildStats(doneEntries, now))).toContain('\x1b');
  });
});
