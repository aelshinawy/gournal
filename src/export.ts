import { format } from 'date-fns';
import type { Entry } from './types';

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
  const grouped = entries.reduce((acc, e) => {
    const projectEntries = acc.get(e.project) || [];
    return acc.set(e.project, [...projectEntries, e]);
  }, new Map<string, Entry[]>());

  if (grouped.size === 0) return '# Gournal Export\n\nNo entries found.\n';

  const body = Array.from(grouped, ([project, projectEntries]) =>
    `## ${project}\n\n` +
    projectEntries
      .map(e => `- \`${format(new Date(e.timestamp), 'yyyy-MM-dd HH:mm')}\` ${e.message}${e.tags.length ? ` (${e.tags.map(t => `#${t}`).join(' ')})` : ''}`)
      .join('\n')
  ).join('\n\n');

  return `# Gournal Export\n\n${body}\n`;
};
