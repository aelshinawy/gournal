# Gournal CLI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chronological work-log command plus undo/stats/tags/projects commands and consistent project+tag filtering, while removing the filter/group-by-project duplication already flagged across `cli.ts`/`report.ts`/`export.ts`/`mcp.ts`.

**Architecture:** Extract shared entry-filtering helpers into one util module, build `log`/`stats` as pure generator functions mirroring the existing `report.ts` pattern, wire everything into `cli.ts` (commander) and `mcp.ts` (MCP tools) using those shared pieces.

**Tech Stack:** TypeScript, commander, date-fns, chalk, fs-extra, Jest (`@swc/jest`), `@modelcontextprotocol/sdk`.

## Global Constraints

- No Claude attribution in any commit message.
- Minimal comments — code should be self-explanatory; comment only a genuinely non-obvious decision.
- One commit per task, exactly at the "Commit" step of each task.
- Match existing repo conventions: comma-separated string for `--tags` CLI flags (same as `add`/`find` today), pure functions get Jest tests, CLI action callbacks in `cli.ts` do not.

---

## File Structure

- **Create** `src/util/entries.util.ts` — `filterByProject`, `filterByTags`, `groupByProject` (moved out of `report.ts`/`export.ts`/`mcp.ts`/`cli.ts`).
- **Create** `src/log.ts` — `generateWorkLog`, the chronological (by-day) counterpart to `report.ts`'s `generateStandupReport`.
- **Create** `src/stats.ts` — `generateStats` and exported `countBy` helper (also reused by the `tags`/`projects` commands and MCP tools).
- **Modify** `src/report.ts`, `src/export.ts` — use `groupByProject` from the new util instead of inline reduces.
- **Modify** `src/mcp.ts` — use `filterByProject`/`filterByTags` from the util; add `get_work_log`, `list_tags`, `list_projects` tools.
- **Modify** `src/cli.ts` — use the shared helpers in `standup`/`export`/`find`; add `log`, `undo`, `stats`, `tags`, `projects` commands; add `--tags` to `standup`/`export`, `--from`/`--to` to `find`.
- **Modify** `README.md` — document the new commands and MCP tools.
- **Create** `test/entries.util.test.ts`, `test/log.test.ts`, `test/stats.test.ts`.
- **Modify** `test/mcp.test.ts` — cover the three new MCP tools.

---

### Task 1: Extract shared entry helpers, refactor existing call sites

**Files:**
- Create: `src/util/entries.util.ts`
- Test: `test/entries.util.test.ts`
- Modify: `src/report.ts`, `src/export.ts`, `src/mcp.ts:11-12`, `src/cli.ts` (`standup`, `export`, `find` commands)

**Interfaces:**
- Produces: `filterByProject(entries: Entry[], project?: string): Entry[]`, `filterByTags(entries: Entry[], tags?: string[]): Entry[]`, `groupByProject(entries: Entry[]): Map<string, Entry[]>` — every later task imports these from `../util/entries.util` (or `./util/entries.util` from `src/cli.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// test/entries.util.test.ts
import { filterByProject, filterByTags, groupByProject } from '../src/util/entries.util';
import { Entry } from '../src/types';

const entries: Entry[] = [
  { timestamp: '2026-07-13T10:00:00.000Z', message: 'Fixed auth middleware', project: 'api', tags: ['bug'] },
  { timestamp: '2026-07-13T11:00:00.000Z', message: 'Updated Docker config', project: 'infra', tags: [] },
  { timestamp: '2026-07-14T09:00:00.000Z', message: 'Added retries', project: 'api', tags: ['bug', 'reliability'] },
];

describe('filterByProject', () => {
  test('returns all entries when no project given', () => {
    expect(filterByProject(entries, undefined)).toEqual(entries);
  });

  test('filters to a single project', () => {
    expect(filterByProject(entries, 'infra')).toEqual([entries[1]]);
  });
});

describe('filterByTags', () => {
  test('returns all entries when no tags given', () => {
    expect(filterByTags(entries, undefined)).toEqual(entries);
  });

  test('requires every given tag to be present (AND semantics)', () => {
    expect(filterByTags(entries, ['bug', 'reliability'])).toEqual([entries[2]]);
  });

  test('returns nothing when a tag is missing', () => {
    expect(filterByTags(entries, ['nonexistent'])).toEqual([]);
  });
});

describe('groupByProject', () => {
  test('groups entries into a Map keyed by project, preserving order', () => {
    const grouped = groupByProject(entries);
    expect(Array.from(grouped.keys())).toEqual(['api', 'infra']);
    expect(grouped.get('api')).toEqual([entries[0], entries[2]]);
    expect(grouped.get('infra')).toEqual([entries[1]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/entries.util.test.ts`
Expected: FAIL — `Cannot find module '../src/util/entries.util'`

- [ ] **Step 3: Write the implementation**

```ts
// src/util/entries.util.ts
import type { Entry } from '../types';

export const filterByProject = (entries: Entry[], project?: string): Entry[] =>
  project ? entries.filter(e => e.project === project) : entries;

export const filterByTags = (entries: Entry[], tags?: string[]): Entry[] =>
  tags && tags.length ? entries.filter(e => tags.every(t => e.tags.includes(t))) : entries;

export const groupByProject = (entries: Entry[]): Map<string, Entry[]> =>
  entries.reduce((acc, e) => {
    const projectEntries = acc.get(e.project) || [];
    return acc.set(e.project, [...projectEntries, e]);
  }, new Map<string, Entry[]>());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/entries.util.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Refactor `src/report.ts` to use `groupByProject`**

```ts
// src/report.ts
import chalk from 'chalk';
import { differenceInDays, format, isWithinInterval } from 'date-fns';
import { reportConfigs } from './constant/report-configs';
import type { Entry } from './types';
import { ReportOptions } from './types/report-config';
import { groupByProject } from './util/entries.util';

export const generateStandupReport = (entries: Entry[], options: ReportOptions) => {
  const now = new Date();
  const config = reportConfigs.find(c => c.predicate(options)) || reportConfigs[reportConfigs.length - 1];

  const range = config.getRange(now);
  const isMultiDay = differenceInDays(range.end, range.start) > 0;

  const groupedEntries = groupByProject(
    entries.filter(e => isWithinInterval(new Date(e.timestamp), config.getRange(now)))
  );

  if (groupedEntries.size === 0) {
    return chalk.yellow('\nNo entries found\n');
  }

  const header = chalk.bold(`\nStandup: ${config.formatTitle(now)}\n\n`);
  const body = Array.from(groupedEntries, ([project, entries]) =>
    `  ${chalk.blue.bold(project)}\n` +
    entries.map(e => `  ${chalk.gray(format(new Date(e.timestamp), isMultiDay ? 'EEE dd - HH:mm' : 'HH:mm'))}  ${e.message}`).join('\n')
  ).join('\n\n');

  return `${header}${body}\n`;
};
```

- [ ] **Step 6: Refactor `src/export.ts` to use `groupByProject`**

```ts
// src/export.ts
import { format } from 'date-fns';
import type { Entry } from './types';
import { groupByProject } from './util/entries.util';

const escapeCsv = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const generateCsvExport = (entries: Entry[]): string => {
  const header = 'timestamp,project,message,tags';
  const rows = entries.map(e =>
    [e.timestamp, e.project, e.message, e.tags.join(';')].map(escapeCsv).join(',')
  );
  return [header, ...rows].join('\n');
};

export const generateMarkdownExport = (entries: Entry[]): string => {
  const grouped = groupByProject(entries);

  if (grouped.size === 0) return '# Gournal Export\n\nNo entries found.\n';

  const body = Array.from(grouped, ([project, projectEntries]) =>
    `## ${project}\n\n` +
    projectEntries
      .map(e => `- \`${format(new Date(e.timestamp), 'yyyy-MM-dd HH:mm')}\` ${e.message}${e.tags.length ? ` (${e.tags.map(t => `#${t}`).join(' ')})` : ''}`)
      .join('\n')
  ).join('\n\n');

  return `# Gournal Export\n\n${body}\n`;
};
```

- [ ] **Step 7: Refactor `src/mcp.ts` to import `filterByProject` instead of defining it locally**

Replace lines 11-12:
```ts
const filterByProject = (entries: Entry[], project?: string): Entry[] =>
  project ? entries.filter(e => e.project === project) : entries;
```
with:
```ts
import { filterByProject } from './util/entries.util';
```
(move this import up next to the other `./` imports at the top of the file; remove the now-unused local `filterByProject` const).

- [ ] **Step 8: Refactor `standup`, `export`, `find` commands in `src/cli.ts` to use the shared helpers**

Add near the top of `src/cli.ts`, alongside the other imports:
```ts
import { filterByProject, filterByTags } from './util/entries.util';
```

Replace the `standup` action body:
```ts
  .action(async (options) => {
    const entries = filterByProject(await readEntries(), options.project);
    console.log(generateStandupReport(entries, options));
  });
```

Replace the `export` action's filtering line:
```ts
    let entries = filterByProject(await readEntries(), options.project);
```
(remove the old `if (options.project) { entries = entries.filter(...) }` block it replaces)

Replace the whole `find` action:
```ts
program
  .command('find <query>')
  .description('Find entries by keyword')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (query: string, options: { project?: string; tags?: string }) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
    const results = entries.filter(entry => entry.message.toLowerCase().includes(query.toLowerCase()));

    console.log(chalk.bold(`Found ${results.length} entries:\n`));
    results.forEach(entry => {
      console.log(
        `${chalk.gray(format(new Date(entry.timestamp), 'MMM EEE dd - HH:mm'))} ` +
        `${chalk.blue(`[${entry.project}]`)} ${entry.message} ` +
        `${entry.tags.map(t => chalk.magenta(`#${t}`)).join(' ')}`
      );
    });
  });
```

- [ ] **Step 9: Run the full test suite and the build to confirm no regressions**

Run: `npm test && npm run build`
Expected: all existing suites (`report.test.ts`, `export.test.ts`, `mcp.test.ts`, `storage.test.ts`) plus the new `entries.util.test.ts` PASS; `tsc` exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/util/entries.util.ts src/report.ts src/export.ts src/mcp.ts src/cli.ts test/entries.util.test.ts
git commit -m "refactor: extract shared filterByProject/filterByTags/groupByProject helpers"
```

---

### Task 2: `gournal log` — chronological work log

**Files:**
- Create: `src/log.ts`
- Test: `test/log.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `reportConfigs` from `./constant/report-configs` (`ReportConfig[]`, each with `.predicate(options)`, `.getRange(now)`, `.formatTitle(now)`), `ReportOptions` from `./types/report-config`, `filterByProject`/`filterByTags` from `./util/entries.util` (Task 1).
- Produces: `generateWorkLog(entries: Entry[], options: ReportOptions): string` — entries passed in are assumed already filtered by project/tags; `generateWorkLog` only applies the date-range filter and day-grouping.

- [ ] **Step 1: Write the failing test**

```ts
// test/log.test.ts
import { generateWorkLog } from '../src/log';
import { Entry } from '../src/types';

describe('Work Log Generation', () => {
  const mockEntries: Entry[] = [
    { timestamp: new Date().toISOString(), message: 'Fixed auth middleware', project: 'api', tags: ['bug'] },
    { timestamp: new Date().toISOString(), message: 'Updated Docker config', project: 'infra', tags: [] },
  ];

  test('Generates daily log grouped by day', () => {
    const log = generateWorkLog(mockEntries, {});
    expect(log).toContain('Work Log: Today');
    expect(log).toContain('Fixed auth middleware');
    expect(log).toContain('[api]');
    expect(log).toContain('[infra]');
  });

  test('Generates weekly log', () => {
    const log = generateWorkLog(mockEntries, { week: true });
    expect(log).toContain('Work Log: Weekly');
  });

  test('Shows a pluralized entry/project count footer', () => {
    const log = generateWorkLog(mockEntries, {});
    expect(log).toContain('2 entries across 2 projects.');
  });

  test('Singular footer wording for exactly one entry', () => {
    const log = generateWorkLog([mockEntries[0]], {});
    expect(log).toContain('1 entry across 1 project.');
  });

  test('Handles empty entries', () => {
    expect(generateWorkLog([], {})).toContain('No entries found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/log.test.ts`
Expected: FAIL — `Cannot find module '../src/log'`

- [ ] **Step 3: Write the implementation**

```ts
// src/log.ts
import chalk from 'chalk';
import { format, isWithinInterval } from 'date-fns';
import { reportConfigs } from './constant/report-configs';
import type { Entry } from './types';
import { ReportOptions } from './types/report-config';

export const generateWorkLog = (entries: Entry[], options: ReportOptions): string => {
  const now = new Date();
  const config = reportConfigs.find(c => c.predicate(options)) || reportConfigs[reportConfigs.length - 1];
  const range = config.getRange(now);

  const inRange = entries
    .filter(e => isWithinInterval(new Date(e.timestamp), range))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (inRange.length === 0) {
    return chalk.yellow('\nNo entries found\n');
  }

  const byDay = inRange.reduce((acc, e) => {
    const day = format(new Date(e.timestamp), 'yyyy-MM-dd');
    return acc.set(day, [...(acc.get(day) || []), e]);
  }, new Map<string, Entry[]>());

  const header = chalk.bold(`\nWork Log: ${config.formatTitle(now)}\n\n`);
  const body = Array.from(byDay, ([day, dayEntries]) =>
    `  ${chalk.blue.bold(format(new Date(day), 'EEE MMM dd'))}\n` +
    dayEntries.map(e =>
      `    ${chalk.gray(format(new Date(e.timestamp), 'HH:mm'))}  ${e.message}  ` +
      `${chalk.blue(`[${e.project}]`)} ${e.tags.map(t => chalk.magenta(`#${t}`)).join(' ')}`
    ).join('\n')
  ).join('\n\n');

  const projectCount = new Set(inRange.map(e => e.project)).size;
  const footer = `\n\n  ${inRange.length} entr${inRange.length === 1 ? 'y' : 'ies'} across ${projectCount} project${projectCount === 1 ? '' : 's'}.`;

  return `${header}${body}${chalk.gray(footer)}\n`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/log.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire the `log` command into `src/cli.ts`**

Add near the top, alongside the other imports:
```ts
import { generateWorkLog } from './log';
```

Add after the `standup` command:
```ts
program
  .command('log')
  .description('Show a chronological work log, grouped by day (today by default)')
  .option('-y, --yesterday', 'Include yesterday\'s entries')
  .option('-w, --week', 'Show weekly log')
  .option('-m, --month', 'Show monthly log')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (options) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
    console.log(generateWorkLog(entries, options));
  });
```

- [ ] **Step 6: Run the full test suite and the build**

Run: `npm test && npm run build`
Expected: all suites PASS, `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/log.ts src/cli.ts test/log.test.ts
git commit -m "feat: add gournal log for a chronological, by-day work log"
```

---

### Task 3: `gournal undo`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `readEntries`/`writeEntries` from `./storage` (already imported).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add the `undo` command to `src/cli.ts`**

Add after the `clear` command:
```ts
program
  .command('undo')
  .description('Remove the most recently added journal entry')
  .action(async () => {
    const entries = await readEntries();
    if (entries.length === 0) {
      console.log(chalk.yellow('No entries to undo.'));
      return;
    }
    const removed = entries.pop()!;
    await writeEntries(entries);
    console.log(chalk.green(`✓ Removed: ${removed.message}`));
  });
```

- [ ] **Step 2: Manually verify against the real store**

Run:
```bash
npm run build
node dist/cli.js add "temp entry for undo test"
node dist/cli.js undo
node dist/cli.js find "temp entry for undo test"
```
Expected: `undo` prints `✓ Removed: temp entry for undo test`; the final `find` reports `Found 0 entries`.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add gournal undo to remove the last entry"
```

---

### Task 4: `gournal stats`

**Files:**
- Create: `src/stats.ts`
- Test: `test/stats.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Produces: `generateStats(entries: Entry[]): string` and `countBy(values: string[]): [string, number][]` (sorted by count descending) — `countBy` is reused by Task 5 (`tags`/`projects` commands) and Task 7 (`list_tags`/`list_projects` MCP tools).

- [ ] **Step 1: Write the failing test**

```ts
// test/stats.test.ts
import { generateStats, countBy } from '../src/stats';
import { Entry } from '../src/types';
import { subDays } from 'date-fns';

const entryAt = (date: Date, project: string, tags: string[] = []): Entry => ({
  timestamp: date.toISOString(),
  message: 'did stuff',
  project,
  tags,
});

describe('countBy', () => {
  test('counts occurrences, sorted descending', () => {
    expect(countBy(['a', 'b', 'a', 'a', 'b'])).toEqual([['a', 3], ['b', 2]]);
  });

  test('returns an empty array for no values', () => {
    expect(countBy([])).toEqual([]);
  });
});

describe('generateStats', () => {
  test('Handles empty entries', () => {
    expect(generateStats([])).toContain('No entries found');
  });

  test('Counts total entries and groups by project/tag', () => {
    const entries = [
      entryAt(new Date(), 'api', ['bug']),
      entryAt(new Date(), 'api', ['bug']),
      entryAt(new Date(), 'infra', []),
    ];
    const stats = generateStats(entries);
    expect(stats).toContain('Total entries: 3');
    expect(stats).toContain('api: 2');
    expect(stats).toContain('infra: 1');
    expect(stats).toContain('#bug: 2');
  });

  test('Computes a streak of consecutive days including today', () => {
    const entries = [
      entryAt(new Date(), 'api'),
      entryAt(subDays(new Date(), 1), 'api'),
      entryAt(subDays(new Date(), 2), 'api'),
    ];
    expect(generateStats(entries)).toContain('Current streak: 3 days');
  });

  test('Streak still counts yesterday if nothing logged yet today', () => {
    const entries = [entryAt(subDays(new Date(), 1), 'api')];
    expect(generateStats(entries)).toContain('Current streak: 1 day');
  });

  test('Streak resets to 0 when the gap is more than a day', () => {
    const entries = [entryAt(subDays(new Date(), 3), 'api')];
    expect(generateStats(entries)).toContain('Current streak: 0 days');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/stats.test.ts`
Expected: FAIL — `Cannot find module '../src/stats'`

- [ ] **Step 3: Write the implementation**

```ts
// src/stats.ts
import chalk from 'chalk';
import { format, subDays } from 'date-fns';
import type { Entry } from './types';

export const countBy = (values: string[]): [string, number][] =>
  Array.from(
    values.reduce((acc, v) => acc.set(v, (acc.get(v) || 0) + 1), new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

const currentStreak = (entries: Entry[]): number => {
  const days = new Set(entries.map(e => format(new Date(e.timestamp), 'yyyy-MM-dd')));
  const today = new Date();
  let cursor = days.has(format(today, 'yyyy-MM-dd')) ? today : subDays(today, 1);

  let streak = 0;
  while (days.has(format(cursor, 'yyyy-MM-dd'))) {
    streak++;
    cursor = subDays(cursor, 1);
  }
  return streak;
};

export const generateStats = (entries: Entry[]): string => {
  if (entries.length === 0) {
    return chalk.yellow('\nNo entries found\n');
  }

  const projectCounts = countBy(entries.map(e => e.project));
  const tagCounts = countBy(entries.flatMap(e => e.tags));
  const streak = currentStreak(entries);

  const header = chalk.bold('\nStats\n\n');
  const total = `  ${chalk.blue('Total entries:')} ${entries.length}\n`;
  const streakLine = `  ${chalk.blue('Current streak:')} ${streak} day${streak === 1 ? '' : 's'}\n\n`;
  const projects = `  ${chalk.bold('By project')}\n` +
    projectCounts.map(([p, c]) => `    ${p}: ${c}`).join('\n') + '\n\n';
  const tags = tagCounts.length
    ? `  ${chalk.bold('By tag')}\n` + tagCounts.map(([t, c]) => `    #${t}: ${c}`).join('\n') + '\n'
    : '';

  return `${header}${total}${streakLine}${projects}${tags}`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/stats.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire the `stats` command into `src/cli.ts`**

Add near the top, alongside the other imports:
```ts
import { generateStats } from './stats';
```

Add after the `log` command:
```ts
program
  .command('stats')
  .description('Show entry counts by project/tag and your current daily streak')
  .option('-p, --project <project>', 'Filter by project name')
  .action(async (options) => {
    const entries = filterByProject(await readEntries(), options.project);
    console.log(generateStats(entries));
  });
```

- [ ] **Step 6: Run the full test suite and the build**

Run: `npm test && npm run build`
Expected: all suites PASS, `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/stats.ts src/cli.ts test/stats.test.ts
git commit -m "feat: add gournal stats for project/tag counts and streak"
```

---

### Task 5: `gournal tags` / `gournal projects`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `countBy` from `./stats` (Task 4).

- [ ] **Step 1: Add the `tags` and `projects` commands to `src/cli.ts`**

Change the existing `./stats` import (added in Task 4) to also bring in `countBy`:
```ts
import { generateStats, countBy } from './stats';
```

Add after the `stats` command:
```ts
program
  .command('tags')
  .description('List distinct tags with entry counts')
  .action(async () => {
    const entries = await readEntries();
    const counts = countBy(entries.flatMap(e => e.tags));
    if (counts.length === 0) {
      console.log(chalk.yellow('No tags found.'));
      return;
    }
    counts.forEach(([tag, count]) => console.log(`${chalk.magenta(`#${tag}`)}  ${count}`));
  });

program
  .command('projects')
  .description('List distinct projects with entry counts')
  .action(async () => {
    const entries = await readEntries();
    const counts = countBy(entries.map(e => e.project));
    if (counts.length === 0) {
      console.log(chalk.yellow('No projects found.'));
      return;
    }
    counts.forEach(([project, count]) => console.log(`${chalk.blue(project)}  ${count}`));
  });
```

- [ ] **Step 2: Manually verify against the real store**

Run:
```bash
npm run build
node dist/cli.js tags
node dist/cli.js projects
```
Expected: each prints one line per distinct tag/project seen in `~/.gournal/entries.json`, counts descending; matches what `node -e "console.log(require('fs').readFileSync(process.env.HOME+'/.gournal/entries.json','utf8'))"` shows.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add gournal tags and gournal projects list commands"
```

---

### Task 6: Filter parity — `find --from/--to`, `--tags` on `standup`/`export`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `filterByTags` (Task 1, already imported in `src/cli.ts`).

- [ ] **Step 1: Add `--tags` to `standup`**

```ts
program
  .command('standup')
  .description('Generate standup report')
  .option('-y, --yesterday', 'Include yesterday\'s entries')
  .option('-w, --week', 'Show weekly summary')
  .option('-m, --month', 'Show monthly summary')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (options) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
    console.log(generateStandupReport(entries, options));
  });
```

- [ ] **Step 2: Add `--tags` to `export`**

```ts
program
  .command('export')
  .description('Export journal entries to Markdown or CSV')
  .option('-f, --format <format>', 'Output format: md or csv', 'md')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-o, --output <file>', 'Write to a file instead of stdout')
  .action(async (options: { format: string; project?: string; tags?: string; output?: string }) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);

    const exportFormat = options.format.toLowerCase();
    if (exportFormat !== 'md' && exportFormat !== 'csv') {
      console.log(chalk.red(`Unknown format "${options.format}". Use "md" or "csv".`));
      return;
    }

    const output = exportFormat === 'csv' ? generateCsvExport(entries) : generateMarkdownExport(entries);

    if (options.output) {
      await fs.writeFile(options.output, output);
      console.log(chalk.green(`✓ Exported ${entries.length} entries to ${options.output}`));
    } else {
      console.log(output);
    }
  });
```

- [ ] **Step 3: Add `--from`/`--to` to `find`**

```ts
program
  .command('find <query>')
  .description('Find entries by keyword')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('--from <date>', 'ISO date lower bound (inclusive)')
  .option('--to <date>', 'ISO date upper bound (inclusive)')
  .action(async (query: string, options: { project?: string; tags?: string; from?: string; to?: string }) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
    if (options.from) entries = entries.filter(e => e.timestamp >= options.from!);
    if (options.to) entries = entries.filter(e => e.timestamp <= options.to!);

    const results = entries.filter(entry => entry.message.toLowerCase().includes(query.toLowerCase()));

    console.log(chalk.bold(`Found ${results.length} entries:\n`));
    results.forEach(entry => {
      console.log(
        `${chalk.gray(format(new Date(entry.timestamp), 'MMM EEE dd - HH:mm'))} ` +
        `${chalk.blue(`[${entry.project}]`)} ${entry.message} ` +
        `${entry.tags.map(t => chalk.magenta(`#${t}`)).join(' ')}`
      );
    });
  });
```

- [ ] **Step 4: Run the full test suite and the build**

Run: `npm test && npm run build`
Expected: all suites PASS, `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --tags to standup/export and --from/--to to find"
```

---

### Task 7: MCP tools — `get_work_log`, `list_tags`, `list_projects`

**Files:**
- Modify: `src/mcp.ts`
- Modify: `test/mcp.test.ts`
- Modify: `README.md` (tools list only — full README pass is Task 8)

**Interfaces:**
- Consumes: `generateWorkLog` (Task 2), `countBy` (Task 4), `filterByTags` (Task 1).

- [ ] **Step 1: Write the failing tests**

Add to the top of `test/mcp.test.ts`, alongside the other `jest.mock` calls:
```ts
jest.mock('../src/log');
```
and alongside the other imports:
```ts
import { generateWorkLog } from '../src/log';
```
and alongside the other mocked-function consts:
```ts
const mockedWorkLog = generateWorkLog as jest.MockedFunction<typeof generateWorkLog>;
```

Add these tests inside the `describe('MCP server tools', ...)` block:
```ts
  test('get_work_log calls generateWorkLog with matching options', async () => {
    mockedWorkLog.mockReturnValue('LOG OUTPUT');
    const client = await connectedClient();
    const result = await client.callTool({ name: 'get_work_log', arguments: { week: true, project: 'api' } });
    expect(mockedWorkLog).toHaveBeenCalledWith([entries[0]], { yesterday: undefined, week: true, month: undefined });
    expect((result.content as any[])[0].text).toBe('LOG OUTPUT');
  });

  test('list_tags returns distinct tags with counts', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'list_tags', arguments: {} });
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual([{ tag: 'bug', count: 1 }]);
  });

  test('list_projects returns distinct projects with counts', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual([{ project: 'api', count: 1 }, { project: 'infra', count: 1 }]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/mcp.test.ts`
Expected: FAIL — unknown tool `get_work_log` / `list_tags` / `list_projects`

- [ ] **Step 3: Implement the tools in `src/mcp.ts`**

Add to the imports at the top:
```ts
import { filterByProject, filterByTags } from './util/entries.util';
import { generateWorkLog } from './log';
import { countBy } from './stats';
```
(replace the existing `import { filterByProject } from './util/entries.util';` from Task 1 with the combined line above, since `filterByTags` is now also needed here.)

Add these tool registrations after `get_standup`'s registration and before `export_entries`'s:
```ts
  server.registerTool(
    'get_work_log',
    {
      title: 'Get chronological work log',
      description: 'Generate a gournal work log grouped by day (today by default, or yesterday/week/month), optionally filtered by project and/or tags.',
      inputSchema: {
        yesterday: z.boolean().optional(),
        week: z.boolean().optional(),
        month: z.boolean().optional(),
        project: z.string().optional().describe('Filter by project name'),
        tags: z.array(z.string()).optional().describe('Filter to entries containing all of these tags'),
      },
    },
    async ({ yesterday, week, month, project, tags }) => {
      let entries = filterByProject(await readEntries(), project);
      entries = filterByTags(entries, tags);
      const options: ReportOptions = { yesterday, week, month };
      return textResult(generateWorkLog(entries, options));
    }
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List distinct tags',
      description: 'List distinct tags used across gournal entries with their counts, optionally filtered by project.',
      inputSchema: {
        project: z.string().optional().describe('Filter by project name'),
      },
    },
    async ({ project }) => {
      const entries = filterByProject(await readEntries(), project);
      const counts = countBy(entries.flatMap(e => e.tags));
      return textResult(JSON.stringify(counts.map(([tag, count]) => ({ tag, count })), null, 2));
    }
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List distinct projects',
      description: 'List distinct projects with entry counts across the whole gournal journal.',
      inputSchema: {},
    },
    async () => {
      const entries = await readEntries();
      const counts = countBy(entries.map(e => e.project));
      return textResult(JSON.stringify(counts.map(([project, count]) => ({ project, count })), null, 2));
    }
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/mcp.test.ts`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Run the full test suite and the build**

Run: `npm test && npm run build`
Expected: all suites PASS, `tsc` exits 0.

- [ ] **Step 6: Update the MCP tools list in `README.md`**

In the "Tools exposed" bullet list, add:
```markdown
- `get_work_log` — generate a chronological work log grouped by day (`yesterday` / `week` / `month`, filterable by `project`/`tags`)
- `list_tags` — distinct tags with counts, filterable by `project`
- `list_projects` — distinct projects with counts
```

- [ ] **Step 7: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts README.md
git commit -m "feat: add get_work_log, list_tags, list_projects MCP tools"
```

---

### Task 8: README pass for the new CLI commands

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Features list**

In the `## ✨ Features` section, add:
```markdown
- **Work Log**: `gournal log` shows a chronological, by-day view (daily/weekly/monthly), unlike `standup`'s per-project grouping
- **Stats**: `gournal stats` shows entry counts by project/tag and your current daily streak
- **Undo**: `gournal undo` removes the most recently added entry
- **Lookup**: `gournal tags` / `gournal projects` list distinct values with counts
```

- [ ] **Step 2: Update the Usage section**

In `## 🚀 Quick Start` → `### Usage`, add after the standup examples:
```bash
# Chronological work log
gournal log --week
gournal log --month --tags bug,testing

# Undo the last entry
gournal undo

# Stats and lookups
gournal stats
gournal tags
gournal projects

# Find entries in a date range
gournal find "auth" --from 2026-07-01 --to 2026-07-15
```

- [ ] **Step 3: Proofread the rendered file**

Run: `cat README.md` and read through the `## 🚀 Quick Start` and `## 🤖 MCP Server` sections top to bottom to confirm the new lines read naturally and no example command has a typo.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document log, undo, stats, tags, projects commands"
```
