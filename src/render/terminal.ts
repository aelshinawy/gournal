import chalk from 'chalk';
import { format, parseISO } from 'date-fns';
import { isEmptyStandup, shortId } from '../core';
import { alsoCountsText, alsoPrs, foldLines, plural } from './format';
import type { Activity, Entry, StandupModel, StatsModel, WorkLogModel } from '../core';

const NO_ENTRIES = (): string => chalk.yellow('\nNo entries found\n');

const openItemLine = (e: Entry): string =>
  `    ${chalk.gray(format(new Date(e.createdAt), 'MMM dd'))}  ${chalk.gray(shortId(e.id))}  ${e.summary}  ${chalk.blue(`[${e.project}]`)}`;

const pad = (xs: string[]): number => Math.max(0, ...xs.map((x) => x.length));
const gray = (lines: string[]): string => lines.map((l) => chalk.gray(l)).join('\n');

const VERB = { commit: 'commit', pr_opened: 'opened', pr_merged: 'merged', review: 'reviewed' } as const;
const activityRef = (a: Activity): string => (a.type === 'commit' ? a.externalId.slice(0, 7) : `#${a.pr ?? a.externalId}`);

function alsoCollapsed(also: NonNullable<StandupModel['also']>): string {
  const prs = alsoPrs(also.activity);
  const verbW = pad(prs.map((p) => p.verb));
  const refW = pad(prs.map((p) => p.ref));
  const head = `  Also: ${alsoCountsText(also.counts)} (--activity to expand)`;
  return gray([head, ...prs.map((p) => `    ${p.verb.padEnd(verbW)}  ${p.ref.padEnd(refW)}  ${p.title}`.trimEnd())]);
}

function alsoExpanded(also: NonNullable<StandupModel['also']>, timeFormat: string): string {
  const sorted = [...also.activity].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const verbW = pad(sorted.map((a) => VERB[a.type]));
  const refW = pad(sorted.map(activityRef));
  const groups = new Map<string, { repo: string; list: Activity[] }>();
  for (const a of sorted) {
    const g = groups.get(a.repo.toLowerCase());
    if (g) g.list.push(a); else groups.set(a.repo.toLowerCase(), { repo: a.repo, list: [a] });
  }
  const lines = ['  Also happened'];
  for (const { repo, list } of groups.values()) {
    lines.push(`  ${repo}`);
    for (const a of list) {
      lines.push(`    ${format(new Date(a.occurredAt), timeFormat)}  ${VERB[a.type].padEnd(verbW)}  ${activityRef(a).padEnd(refW)}  ${a.title ?? ''}`.trimEnd());
    }
  }
  return gray(lines);
}

export function standupText(m: StandupModel, opts: { expandActivity?: boolean } = {}): string {
  if (isEmptyStandup(m)) return NO_ENTRIES();
  const timeFormat = m.isMultiDay ? 'EEE dd - HH:mm' : 'HH:mm';
  const activityTimeFormat = m.isMultiDay ? 'EEE dd HH:mm' : 'HH:mm';
  // Done needs its header when any other section follows it, Also included.
  const hasMore = m.blockers.length > 0 || m.next.length > 0 || m.stale.count > 0 || m.also !== null;

  const done = m.done.map(({ project, entries }) =>
    `  ${chalk.blue.bold(project)}\n` +
    entries.map((e) => {
      const time = format(new Date(e.createdAt), timeFormat);
      const fold = foldLines(m.linked[e.id] ?? []).map((l) => `\n${chalk.gray(`${' '.repeat(time.length + 4)}\u21b3 ${l}`)}`).join('');
      return `  ${chalk.gray(time)}  ${e.summary}${fold}`;
    }).join('\n'),
  ).join('\n\n');

  const sections: string[] = [];
  if (m.done.length > 0) sections.push((hasMore ? `  ${chalk.green.bold('Done')}\n` : '') + done);
  if (m.blockers.length > 0) sections.push(`  ${chalk.red.bold('Blockers')}\n${m.blockers.map(openItemLine).join('\n')}`);
  if (m.next.length > 0) sections.push(`  ${chalk.yellow.bold('Next')}\n${m.next.map(openItemLine).join('\n')}`);
  if (m.stale.count > 0) {
    const n = m.stale.count;
    sections.push(chalk.gray(`  Stale: ${n} open ${plural(n, 'item', 'items')} older than ${m.stale.days} ${plural(m.stale.days, 'day', 'days')} (ids: ${m.stale.ids.join(', ')})`));
  }
  if (m.also) sections.push(opts.expandActivity ? alsoExpanded(m.also, activityTimeFormat) : alsoCollapsed(m.also));
  return `${chalk.bold(`\nStandup: ${m.title}\n\n`)}${sections.join('\n\n')}\n`;
}

export function workLogText(m: WorkLogModel): string {
  if (m.count === 0) return NO_ENTRIES();
  const header = chalk.bold(`\nWork Log: ${m.title}\n\n`);
  const body = m.days.map(({ date, entries }) =>
    `  ${chalk.blue.bold(format(parseISO(date), 'EEE MMM dd'))}\n` +
    entries.map((e) =>
      `    ${chalk.gray(format(new Date(e.createdAt), 'HH:mm'))} ${chalk.gray(shortId(e.id))}  ${e.summary}  ` +
      `${chalk.blue(`[${e.project}]`)} ${e.tags.map((t) => chalk.magenta(`#${t}`)).join(' ')}` +
      foldLines(m.linked[e.id] ?? []).map((l) => `\n${chalk.gray(`${' '.repeat(20)}\u21b3 ${l}`)}`).join(''),
    ).join('\n'),
  ).join('\n\n');
  const footer = `\n\n  ${m.count} ${plural(m.count, 'entry', 'entries')} across ${m.projectCount} ${plural(m.projectCount, 'project', 'projects')}.`;
  return `${header}${body}${chalk.gray(footer)}\n`;
}

export function statsText(m: StatsModel): string {
  if (m.total === 0) return NO_ENTRIES();
  const header = chalk.bold('\nStats\n\n');
  const total = `  ${chalk.blue('Total entries:')} ${m.total}\n`;
  const streak = `  ${chalk.blue('Current streak:')} ${m.streak} ${plural(m.streak, 'day', 'days')}\n\n`;
  const projects = `  ${chalk.bold('By project')}\n` + m.byProject.map(([p, c]) => `    ${p}: ${c}`).join('\n') + '\n\n';
  const tags = m.byTag.length
    ? `  ${chalk.bold('By tag')}\n` + m.byTag.map(([t, c]) => `    #${t}: ${c}`).join('\n') + '\n'
    : '';
  return `${header}${total}${streak}${projects}${tags}`;
}

export function entryLinesText(entries: Entry[]): string {
  return entries.map((e) =>
    `${chalk.gray(format(new Date(e.createdAt), 'MMM EEE dd - HH:mm'))} ` +
    `${chalk.gray(shortId(e.id))} ` +
    `${chalk.blue(`[${e.project}]`)} ${e.summary} ` +
    `${e.tags.map((t) => chalk.magenta(`#${t}`)).join(' ')}`,
  ).join('\n');
}

export function tagCountsText(rows: { tag: string; count: number }[]): string {
  if (rows.length === 0) return chalk.yellow('No tags found.');
  return rows.map((r) => `${chalk.magenta(`#${r.tag}`)}  ${r.count}`).join('\n');
}

export function projectCountsText(rows: { project: string; count: number }[]): string {
  if (rows.length === 0) return chalk.yellow('No projects found.');
  return rows.map((r) => `${chalk.blue(r.project)}  ${r.count}`).join('\n');
}
