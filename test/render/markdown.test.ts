import chalk from 'chalk';
import { buildStandup, buildWorkLog, resolvePeriod } from '../../src/core';
import { entriesMarkdown, exportCsv, exportMarkdown, standupMarkdown, standupJson, workLogMarkdown, workLogJson } from '../../src/render';
import { makeEntry } from '../core/factory';

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
});
