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