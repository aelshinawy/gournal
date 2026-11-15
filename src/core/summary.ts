export const MAX_SUMMARY = 120;
const ELLIPSIS = '...';

export function summaryLength(s: string): number {
  return Array.from(s).length;
}

/** CR, LF, U+2028, and U+2029 all end a line. */
const LINE_BREAK = /[\r\n\u2028\u2029]/;
export const hasLineBreak = (s: string): boolean => LINE_BREAK.test(s);

function firstSentence(trimmed: string): string {
  const match = /[.!?](?=\s|$)|[\r\n\u2028\u2029]/.exec(trimmed);
  if (!match) return trimmed;
  const end = /[.!?]/.test(match[0]) ? match.index + 1 : match.index;
  return trimmed.slice(0, end).trim();
}

function truncate(sentence: string): string {
  const chars = Array.from(sentence);
  if (chars.length <= MAX_SUMMARY) return sentence;
  const cutAt = MAX_SUMMARY - ELLIPSIS.length;
  const head = chars.slice(0, cutAt + 1);
  const lastSpace = head.lastIndexOf(' ');
  const kept = lastSpace > 0 ? head.slice(0, lastSpace) : head.slice(0, cutAt);
  return kept.join('').trimEnd() + ELLIPSIS;
}

export function splitSummary(text: string): { summary: string; details: string | null } {
  const trimmed = text.trim();
  const sentence = firstSentence(trimmed);
  const summary = truncate(sentence);
  // details is null only when the summary already holds the whole text.
  return { summary, details: summary === trimmed ? null : text };
}

export type SummaryCheck = { ok: true; summary: string; details: string | null } | { ok: false; error: string };

export function checkSummary(
  summary: string,
  details: string | null | undefined,
  opts: { allowSplit: boolean }
): SummaryCheck {
  const trimmed = summary.trim();
  const length = summaryLength(trimmed);
  // A second line counts as over the limit: a summary is one line.
  const multiline = hasLineBreak(trimmed);
  if (length <= MAX_SUMMARY && !multiline) return { ok: true, summary: trimmed, details: details ?? null };
  if (!opts.allowSplit) {
    return { ok: false, error: multiline
      ? `summary must be one line, max ${MAX_SUMMARY}. Put the rest in details.`
      : `summary is ${length} chars, max ${MAX_SUMMARY}. Put one line in summary and the rest in details.` };
  }
  const split = splitSummary(trimmed);
  const full = details ? `${split.details ?? split.summary}\n\n${details}` : split.details;
  return { ok: true, summary: split.summary, details: full };
}
