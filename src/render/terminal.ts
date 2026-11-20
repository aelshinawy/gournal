import { blue, blueBold, bold, gray, greenBold, magenta, redBold, yellow, yellowBold } from './style';
import { formatMonthDay, formatMonthWeekdayDayDashTime, formatTime, formatWeekdayDayDashTime, formatWeekdayDayTime, formatWeekdayMonthDay, isEmptyStandup, parseIso, shortId } from '../core';
import { alsoCountsText, alsoPrs, foldLines, plural, stripControl as safe } from './format';
import type { Activity, Entry, StandupModel, StatsModel, WorkLogModel } from '../core';

// Every string from an entry or from GitHub goes through safe() before it is printed.
// The style module adds its own escape codes after that, so they are the only ones in the output.
const safeFold = (list: Activity[] | undefined): string[] => foldLines(list ?? []).map(safe);
const safePrs = (list: Activity[]) => alsoPrs(list).map((p) => ({ ...p, ref: safe(p.ref), title: safe(p.title) }));

const NO_ENTRIES = (): string => yellow('\nNo entries found\n');

const openItemLine = (e: Entry): string =>
  `    ${gray(formatMonthDay(new Date(e.createdAt)))}  ${gray(safe(shortId(e.id)))}  ${safe(e.summary)}  ${blue(`[${safe(e.project)}]`)}`;

const pad = (xs: string[]): number => Math.max(0, ...xs.map((x) => x.length));
const grayLines = (lines: string[]): string => lines.map((l) => gray(l)).join('\n');

const VERB = { commit: 'commit', pr_opened: 'opened', pr_merged: 'merged', review: 'reviewed' } as const;
const activityRef = (a: Activity): string => safe(a.type === 'commit' ? a.externalId.slice(0, 7) : `#${a.pr ?? a.externalId}`);

function alsoCollapsed(also: NonNullable<StandupModel['also']>): string {
  const prs = safePrs(also.activity);
  const verbW = pad(prs.map((p) => p.verb));
  const refW = pad(prs.map((p) => p.ref));
  const head = `  Also: ${alsoCountsText(also.counts)} (--activity to expand)`;
  return grayLines([head, ...prs.map((p) => `    ${p.verb.padEnd(verbW)}  ${p.ref.padEnd(refW)}  ${p.title}`.trimEnd())]);
}

function alsoExpanded(also: NonNullable<StandupModel['also']>, time: (d: Date) => string): string {
  const sorted = [...also.activity].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const verbW = pad(sorted.map((a) => VERB[a.type]));
  const refW = pad(sorted.map(activityRef));
  const groups = new Map<string, { repo: string; list: Activity[] }>();
  for (const a of sorted) {
    const g = groups.get(a.repo.toLowerCase());
    if (g) g.list.push(a); else groups.set(a.repo.toLowerCase(), { repo: safe(a.repo), list: [a] });
  }
  const lines = ['  Also happened'];
  for (const { repo, list } of groups.values()) {
    lines.push(`  ${repo}`);
    for (const a of list) {
      lines.push(`    ${time(new Date(a.occurredAt))}  ${VERB[a.type].padEnd(verbW)}  ${activityRef(a).padEnd(refW)}  ${safe(a.title ?? '')}`.trimEnd());
    }
  }
  return grayLines(lines);
}

export function standupText(m: StandupModel, opts: { expandActivity?: boolean } = {}): string {
  if (isEmptyStandup(m)) return NO_ENTRIES();
  const entryTime = m.isMultiDay ? formatWeekdayDayDashTime : formatTime;
  const activityTime = m.isMultiDay ? formatWeekdayDayTime : formatTime;
  // Done needs its header when any other section follows it, Also included.
  const hasMore = m.blockers.length > 0 || m.next.length > 0 || m.stale.count > 0 || m.also !== null;

  const done = m.done.map(({ project, entries }) =>
    `  ${blueBold(safe(project))}\n` +
    entries.map((e) => {
      const time = entryTime(new Date(e.createdAt));
      const fold = safeFold(m.linked[e.id]).map((l) => `\n${gray(`${' '.repeat(time.length + 4)}\u21b3 ${l}`)}`).join('');
      return `  ${gray(time)}  ${safe(e.summary)}${fold}`;
    }).join('\n'),
  ).join('\n\n');

  const sections: string[] = [];
  if (m.done.length > 0) sections.push((hasMore ? `  ${greenBold('Done')}\n` : '') + done);
  if (m.blockers.length > 0) sections.push(`  ${redBold('Blockers')}\n${m.blockers.map(openItemLine).join('\n')}`);
  if (m.next.length > 0) sections.push(`  ${yellowBold('Next')}\n${m.next.map(openItemLine).join('\n')}`);
  if (m.stale.count > 0) {
    const n = m.stale.count;
    sections.push(gray(`  Stale: ${n} open ${plural(n, 'item', 'items')} older than ${m.stale.days} ${plural(m.stale.days, 'day', 'days')} (ids: ${m.stale.ids.map(safe).join(', ')})`));
  }
  if (m.also) sections.push(opts.expandActivity ? alsoExpanded(m.also, activityTime) : alsoCollapsed(m.also));
  return `${bold(`\nStandup: ${safe(m.title)}\n\n`)}${sections.join('\n\n')}\n`;
}

export function workLogText(m: WorkLogModel): string {
  if (m.count === 0) return NO_ENTRIES();
  const header = bold(`\nWork Log: ${safe(m.title)}\n\n`);
  const body = m.days.map(({ date, entries }) =>
    `  ${blueBold(formatWeekdayMonthDay(parseIso(date)))}\n` +
    entries.map((e) =>
      `    ${gray(formatTime(new Date(e.createdAt)))} ${gray(safe(shortId(e.id)))}  ${safe(e.summary)}  ` +
      `${blue(`[${safe(e.project)}]`)} ${e.tags.map((t) => magenta(`#${safe(t)}`)).join(' ')}` +
      safeFold(m.linked[e.id]).map((l) => `\n${gray(`${' '.repeat(20)}\u21b3 ${l}`)}`).join(''),
    ).join('\n'),
  ).join('\n\n');
  const footer = `\n\n  ${m.count} ${plural(m.count, 'entry', 'entries')} across ${m.projectCount} ${plural(m.projectCount, 'project', 'projects')}.`;
  return `${header}${body}${gray(footer)}\n`;
}

export function statsText(m: StatsModel): string {
  if (m.total === 0) return NO_ENTRIES();
  const header = bold('\nStats\n\n');
  const total = `  ${blue('Total entries:')} ${m.total}\n`;
  const streak = `  ${blue('Current streak:')} ${m.streak} ${plural(m.streak, 'day', 'days')}\n\n`;
  const projects = `  ${bold('By project')}\n` + m.byProject.map(([p, c]) => `    ${safe(p)}: ${c}`).join('\n') + '\n\n';
  const tags = m.byTag.length
    ? `  ${bold('By tag')}\n` + m.byTag.map(([t, c]) => `    #${safe(t)}: ${c}`).join('\n') + '\n'
    : '';
  return `${header}${total}${streak}${projects}${tags}`;
}

export function entryLinesText(entries: Entry[]): string {
  return entries.map((e) =>
    `${gray(formatMonthWeekdayDayDashTime(new Date(e.createdAt)))} ` +
    `${gray(safe(shortId(e.id)))} ` +
    `${blue(`[${safe(e.project)}]`)} ${safe(e.summary)} ` +
    `${e.tags.map((t) => magenta(`#${safe(t)}`)).join(' ')}`,
  ).join('\n');
}

export function tagCountsText(rows: { tag: string; count: number }[]): string {
  if (rows.length === 0) return yellow('No tags found.');
  return rows.map((r) => `${magenta(`#${safe(r.tag)}`)}  ${r.count}`).join('\n');
}

export function projectCountsText(rows: { project: string; count: number }[]): string {
  if (rows.length === 0) return yellow('No projects found.');
  return rows.map((r) => `${blue(safe(r.project))}  ${r.count}`).join('\n');
}
