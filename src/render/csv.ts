import type { Entry } from '../core';

/** A spreadsheet runs a cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A plain number, such as -5 or +3.5, is not a formula. Leave it as it is. */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** Prefix a formula-like cell with a single quote, so a spreadsheet shows it as text. */
const neutralize = (value: string): string =>
  FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;

const escapeCsv = (raw: string): string => {
  const value = neutralize(raw);
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

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
