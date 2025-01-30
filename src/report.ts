import { format } from 'date-fns';
import chalk from 'chalk';
import type { Entry } from './types.js';

export function generateStandupReport(entries: Entry[]): string {
  const today = new Date();
  const todayEntries = entries.filter(entry => 
    new Date(entry.timestamp).toDateString() === today.toDateString()
  );

  const grouped = todayEntries.reduce((acc, entry) => {
    acc[entry.project] = acc[entry.project] || [];
    acc[entry.project].push(entry);
    return acc;
  }, {} as Record<string, Entry[]>);

  let output = chalk.bold(`\nStandup for ${format(today, 'yyyy-MM-dd')}\n\n`);
  
  for (const [project, entries] of Object.entries(grouped)) {
    output += chalk.blue.bold(`Project: ${project}\n`);
    entries.forEach(e => output += `- ${e.message}\n`);
    output += '\n';
  }

  return output;
}