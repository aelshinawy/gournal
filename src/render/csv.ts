import type { Entry } from '../core';

const escapeCsv = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const HEADER = 'timestamp,project,message,tags,summary,details,kind,refs';

export function exportCsv(entries: Entry[]): string {
  const rows = entries.map((e) =>
    [
      e.createdAt,
      e.project,
      e.details ? `${e.summary}\n\n${e.details}` : e.summary,
      e.tags.join(';'),
      e.summary,
      e.details ?? '',
      e.kind,
      e.refs.map((r) => `${r.type}:${r.value}`).join(';'),
    ].map(escapeCsv).join(','),
  );
  return [HEADER, ...rows].join('\n');
}
