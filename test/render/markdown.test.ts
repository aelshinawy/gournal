import chalk from 'chalk';
import { buildStandup, buildWorkLog, resolvePeriod } from '../../src/core';
import { entriesMarkdown, exportCsv, exportMarkdown, standupMarkdown, standupJson, workLogMarkdown, workLogJson } from '../../src/render';
import { makeActivity, makeEntry } from '../core/factory';

const now = new Date(2026, 10, 15, 12, 0, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0);
const id = (suffix: string) => `01TESTID0000000000${suffix}`;

describe('markdown renderers', () => {
  const done = makeEntry({ createdAt: at(15, 10, 30), summary: 'Shipped find', project: 'gournal', tags: ['release'], id: id('ZZZZZZZZ').slice(0, 18) + 'ABCD1234' });
  const blocker = makeEntry({ createdAt: at(13, 9), summary: 'Stuck on CI', project: 'gournal', kind: 'blocker', status: 'open', id: 'XXXXXXXXXXXXXXXXXXXXABCD1234' });
  const next = makeEntry({ createdAt: at(12, 9), summary: 'Write docs', project: 'gournal', kind: 'next', status: 'open', id: 'XXXXXXXXXXXXXXXXXXXXEFGH5678' });
  const stale = makeEntry({ createdAt: at(1, 9), summary: 'Old', project: 'gournal', kind: 'next', status: 'open', id: 'XXXXXXXXXXXXXXXXXXXXIJKL9012' });
  const period = resolvePeriod({}, now, 1);
  const model = buildStandup({ period, done: [done], open: [blocker, next, stale], now, staleAfterDays: 14 });

  test('standup markdown', () => {
    expect(standupMarkdown(model)).toBe([
      '## Standup: Today (2026-11-15)', '', '### Done', '', '**gournal**', '- 10:30 Shipped find', '',
      '### Blockers', '- `ABCD1234` Stuck on CI (gournal, since Nov 13)', '',
      '### Next', '- `EFGH5678` Write docs (gournal, since Nov 12)', '',
      'Stale: 1 open item older than 14 days: `IJKL9012`', '',
    ].join('\n'));
  });

  test('stale line uses the singular day word for 1 day', () => {
    const one = buildStandup({ period, done: [], open: [stale], now, staleAfterDays: 1 });
    expect(standupMarkdown(one)).toContain('Stale: 1 open item older than 1 day: `IJKL9012`');
  });

  test('standup markdown skips empty sections and handles empty', () => {
    const onlyDone = buildStandup({ period, done: [done], open: [], now, staleAfterDays: 14 });
    expect(standupMarkdown(onlyDone)).toBe(
      '## Standup: Today (2026-11-15)\n\n### Done\n\n**gournal**\n- 10:30 Shipped find\n');
    expect(standupMarkdown(buildStandup({ period, done: [], open: [], now, staleAfterDays: 14 }))).toBe('No entries found.\n');
  });

  test('multi-day standup markdown uses day-of-week time', () => {
    const m = buildStandup({ period: resolvePeriod({ week: true }, now, 1), done: [done], open: [], now, staleAfterDays: 14 });
    expect(standupMarkdown(m)).toContain('- Sun 15 10:30 Shipped find');
  });

  test('work log markdown', () => {
    const log = workLogMarkdown(buildWorkLog(period, [done]));
    expect(log).toBe([
      '## Work Log: Today (2026-11-15)', '', '### Sun Nov 15',
      '- 10:30 `ABCD1234` Shipped find [gournal] #release', '', '1 entry across 1 project.', '',
    ].join('\n'));
    const two = workLogMarkdown(buildWorkLog(period, [done, makeEntry({ createdAt: at(15, 11), project: 'api' })]));
    expect(two).toContain('2 entries across 2 projects.');
    expect(workLogMarkdown(buildWorkLog(period, []))).toBe('No entries found.\n');
  });

  test('entriesMarkdown', () => {
    expect(entriesMarkdown([])).toBe('No entries found.\n');
    expect(entriesMarkdown([done, blocker])).toBe([
      '- 2026-11-15 10:30 `ABCD1234` [gournal] Shipped find #release',
      '- 2026-11-13 09:00 `ABCD1234` [gournal] Stuck on CI (blocker, open)', '',
    ].join('\n'));
  });

  test('exportMarkdown groups by project with details in the message', () => {
    const a = makeEntry({ createdAt: '2026-07-13T10:00:00.000Z', summary: 'Fixed auth middleware', project: 'api', tags: ['bug'] });
    const b = makeEntry({ createdAt: '2026-07-13T11:00:00.000Z', summary: 'Note', details: 'More text', project: 'infra' });
    const md = exportMarkdown([a, b]);
    expect(md).toContain('## api');
    expect(md).toContain('## infra');
    expect(md).toContain('Fixed auth middleware');
    expect(md).toContain('(#bug)');
    expect(md).toContain('Note\n\nMore text');
    expect(exportMarkdown([])).toBe('# Gournal Export\n\nNo entries found.\n');
  });

  test('markdown, json, and csv never contain ANSI, even with chalk forced on', () => {
    const level = chalk.level;
    chalk.level = 3;
    try {
      expect(chalk.red('x')).toContain('\x1b');
      const outputs = [
        standupMarkdown(model), workLogMarkdown(buildWorkLog(period, [done])), entriesMarkdown([done, blocker]),
        exportMarkdown([done]), exportCsv([done]), JSON.stringify(standupJson(model)),
        JSON.stringify(workLogJson(buildWorkLog(period, [done]))),
      ];
      for (const o of outputs) expect(o).not.toContain('\x1b');
    } finally { chalk.level = level; }
  });

  describe('activity', () => {
    const mergedPr4 = makeActivity({ type: 'pr_merged', repo: 'acme/gournal', pr: 4, title: 'Phase 2 layers' });
    const commits = [1, 2, 3].map(() => makeActivity({ type: 'commit', repo: 'acme/gournal' }));
    const merged327 = makeActivity({ type: 'pr_merged', repo: 'acme/widgets', pr: 327, title: 'Add widget cache' });
    const reviewed412 = makeActivity({ type: 'review', repo: 'octo/app', pr: 412, title: 'Fix login redirect' });
    const withActivity = buildStandup({
      period, done: [done], open: [], now, staleAfterDays: 14,
      linked: { [done.id]: [mergedPr4, ...commits] }, unlinked: [mergedPr4, ...commits, merged327, reviewed412],
    });

    test('no activity looks as before', () => {
      const plain = buildStandup({ period, done: [done], open: [], now, staleAfterDays: 14 });
      expect(standupMarkdown({ ...plain, linked: {}, also: null })).toBe(standupMarkdown(plain));
      expect(standupMarkdown(plain)).toBe('## Standup: Today (2026-11-15)\n\n### Done\n\n**gournal**\n- 10:30 Shipped find\n');
    });

    test('markdown uses the collapsed form and sub-bullets', () => {
      expect(standupMarkdown(withActivity)).toBe([
        '## Standup: Today (2026-11-15)', '', '### Done', '', '**gournal**',
        '- 10:30 Shipped find',
        '  - merged #4 Phase 2 layers',
        '  - 3 commits', '',
        '- Also: 1 PR merged, 1 review in 2 repos',
        '  - merged acme/widgets#327 Add widget cache',
        '  - reviewed octo/app#412 Fix login redirect', '',
      ].join('\n'));
    });

    test('Also renders last, after Blockers, Next, and the Stale line', () => {
      const old = makeEntry({ kind: 'next', status: 'open', createdAt: new Date(2026, 9, 1), summary: 'Old next' });
      const blocker = makeEntry({ kind: 'blocker', status: 'open', createdAt: new Date(2026, 10, 14, 9), summary: 'A blocker' });
      const next = makeEntry({ kind: 'next', status: 'open', createdAt: new Date(2026, 10, 14, 10), summary: 'A next' });
      const out = standupMarkdown(buildStandup({ period, done: [done], open: [old, blocker, next], now, staleAfterDays: 14, unlinked: [merged327] }));
      expect(out.indexOf('### Next')).toBeGreaterThan(out.indexOf('### Blockers'));
      expect(out.indexOf('Stale:')).toBeGreaterThan(out.indexOf('### Next'));
      expect(out.indexOf('- Also:')).toBeGreaterThan(out.indexOf('Stale:'));
    });

    test('work log folds linked activity as sub-bullets', () => {
      const log = workLogMarkdown(buildWorkLog(period, [done], { [done.id]: [mergedPr4, commits[0]] }));
      expect(log).toContain('- 10:30 `ABCD1234` Shipped find [gournal] #release\n  - merged #4 Phase 2 layers\n  - 1 commit\n');
      expect(log).not.toContain('Also');
    });

    test('markdown and json stay free of ANSI with activity', () => {
      const level = chalk.level;
      chalk.level = 3;
      try {
        expect(standupMarkdown(withActivity)).not.toContain('\x1b');
        expect(JSON.stringify(standupJson(withActivity))).not.toContain('\x1b');
      } finally { chalk.level = level; }
    });
  });
});
