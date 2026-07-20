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
