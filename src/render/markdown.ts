import { formatDayTime, formatMonthDay, formatTime, formatWeekdayDayTime, formatWeekdayMonthDay, groupBy, isEmptyStandup, parseIso, shortId } from '../core';
import { alsoCountsText, alsoPrs, foldLines, plural } from './format';
import type { Activity, Entry, StandupModel, WorkLogModel } from '../core';

const NONE = 'No entries found.\n';
const fold = (list: Activity[] | undefined): string[] => foldLines(list ?? []).map((l) => `  - ${l}`);
const tagText = (e: Entry): string => e.tags.map((t) => ` #${t}`).join('');

export function standupMarkdown(m: StandupModel): string {
  if (isEmptyStandup(m)) return NONE;
  const time = m.isMultiDay ? formatWeekdayDayTime : formatTime;
  const open = (e: Entry): string =>
    `- \`${shortId(e.id)}\` ${e.summary} (${e.project}, since ${formatMonthDay(new Date(e.createdAt))})`;
  const lines: string[] = [`## Standup: ${m.title}`, ''];
  if (m.done.length > 0) {
    lines.push('### Done', '');
    for (const { project, entries } of m.done) {
      lines.push(`**${project}**`, ...entries.flatMap((e) => [`- ${time(new Date(e.createdAt))} ${e.summary}`, ...fold(m.linked[e.id])]), '');
    }
  }
  if (m.blockers.length > 0) lines.push('### Blockers', ...m.blockers.map(open), '');
  if (m.next.length > 0) lines.push('### Next', ...m.next.map(open), '');
  if (m.stale.count > 0) {
    const n = m.stale.count;
    lines.push(`Stale: ${n} open ${plural(n, 'item', 'items')} older than ${m.stale.days} ${plural(m.stale.days, 'day', 'days')}: ${m.stale.ids.map((id) => `\`${id}\``).join(', ')}`, '');
  }
  if (m.also) {
    lines.push(`- Also: ${alsoCountsText(m.also.counts)}`, ...alsoPrs(m.also.activity).map((p) => `  - ${p.verb} ${p.ref}${p.title ? ` ${p.title}` : ''}`), '');
  }
  return lines.join('\n');
}

export function workLogMarkdown(m: WorkLogModel): string {
  if (m.count === 0) return NONE;
  const lines: string[] = [`## Work Log: ${m.title}`, ''];
  for (const { date, entries } of m.days) {
    lines.push(`### ${formatWeekdayMonthDay(parseIso(date))}`);
    for (const e of entries) {
      lines.push(`- ${formatTime(new Date(e.createdAt))} \`${shortId(e.id)}\` ${e.summary} [${e.project}]${tagText(e)}`, ...fold(m.linked[e.id]));
    }
    lines.push('');
  }
  lines.push(`${m.count} ${plural(m.count, 'entry', 'entries')} across ${m.projectCount} ${plural(m.projectCount, 'project', 'projects')}.`, '');
  return lines.join('\n');
}

export function entriesMarkdown(entries: Entry[]): string {
  if (entries.length === 0) return NONE;
  const lines = entries.map((e) => {
    const suffix = e.kind === 'done' ? '' : ` (${[e.kind, e.status].filter(Boolean).join(', ')})`;
    return `- ${formatDayTime(new Date(e.createdAt))} \`${shortId(e.id)}\` [${e.project}] ${e.summary}${tagText(e)}${suffix}`;
  });
  return `${lines.join('\n')}\n`;
}

export function exportMarkdown(entries: Entry[]): string {
  if (entries.length === 0) return '# Gournal Export\n\nNo entries found.\n';
  const body = Array.from(groupBy(entries, (e) => e.project), ([project, list]) =>
    `## ${project}\n\n` +
    list.map((e) => {
      const message = e.details ? `${e.summary}\n\n${e.details}` : e.summary;
      return `- \`${formatDayTime(new Date(e.createdAt))}\` ${message}${e.tags.length ? ` (${e.tags.map((t) => `#${t}`).join(' ')})` : ''}`;
    }).join('\n'),
  ).join('\n\n');
  return `# Gournal Export\n\n${body}\n`;
}
