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
