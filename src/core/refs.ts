import type { Ref } from './types';

export const NON_TICKET_PREFIXES: readonly string[] = [
  'step', 'wp', 'phase', 'v', 'sprint', 'week', 'day', 'part', 'round', 'node', 'ios', 'android',
  'gpt', 'utf', 'sha', 'iso', 'http', 'https', 'covid', 'es', 'py', 'python', 'rfc', 'ipv', 'win', 'macos',
];

export interface TicketOptions { ticketPrefixes?: string[] }

const TICKET_TAG = /^([a-z][a-z0-9]{1,9})-(\d+)$/;

/** Turn a ticket-shaped token such as "sbdc-12" or "PR-473" into a ref. Returns null if it is not one. */
export function ticketToRef(token: string, opts: TicketOptions = {}): Ref | null {
  const m = TICKET_TAG.exec(token.toLowerCase());
  if (!m) return null;
  const prefix = m[1];
  if (prefix === 'pr') return { type: 'pr', value: m[2] };
  const allowed = opts.ticketPrefixes?.map((p) => p.toLowerCase());
  if (allowed && allowed.length > 0) {
    if (!allowed.includes(prefix)) return null;
  } else if (NON_TICKET_PREFIXES.includes(prefix)) {
    return null;
  }
  return { type: 'jira', value: `${prefix.toUpperCase()}-${m[2]}` };
}

export function mergeRefs(...lists: Ref[][]): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const list of lists) {
    for (const ref of list) {
      const key = `${ref.type}\u0000${ref.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

export function extractRefs(text: string, opts: TicketOptions = {}): Ref[] {
  const found: { index: number; ref: Ref }[] = [];
  const add = (index: number, ref: Ref) => found.push({ index, ref });

  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g)) {
    const ref = ticketToRef(m[0], opts);
    if (ref) add(m.index!, ref);
  }
  for (const m of text.matchAll(/\bPR ?#?(\d+)\b/gi)) add(m.index!, { type: 'pr', value: m[1] });
  for (const m of text.matchAll(/(?<![\w/])#(\d{2,5})\b/g)) add(m.index!, { type: 'pr', value: m[1] });
  for (const m of text.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g)) {
    add(m.index!, { type: 'pr', value: m[3], repo: `${m[1]}/${m[2]}` });
  }
  for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    const before = text[m.index! - 1];
    const after = text[m.index! + m[0].length];
    if (before === '-' || after === '-') continue;
    if (/\d/.test(m[0]) && /[a-f]/.test(m[0])) add(m.index!, { type: 'commit', value: m[0] });
  }
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    const value = m[0].replace(/[)\]>`'\";:!.,*]+$/, '');
    if (value) add(m.index!, { type: 'url', value });
  }

  // Stable sort keeps pattern order for ties.
  found.sort((a, b) => a.index - b.index);
  const merged = mergeRefs(found.map((f) => f.ref));
  // A repo-aware pr ref replaces a bare one with the same value. It keeps the bare one's position.
  const repoByPr = new Map<string, Ref>();
  for (const { ref } of found) if (ref.type === 'pr' && ref.repo && !repoByPr.has(ref.value)) repoByPr.set(ref.value, ref);
  return merged.map((r) => (r.type === 'pr' && !r.repo ? repoByPr.get(r.value) ?? r : r));
}
