import type { Ref } from './types';

export const NON_TICKET_PREFIXES = ['step', 'wp', 'phase', 'v'];

const TICKET_TAG = /^([a-z][a-z0-9]{1,9})-(\d+)$/;

/** Turn a ticket-shaped token such as "sbdc-12" or "PR-473" into a ref. Returns null if it is not one. */
export function ticketToRef(token: string): Ref | null {
  const m = TICKET_TAG.exec(token.toLowerCase());
  if (!m) return null;
  const prefix = m[1];
  if (NON_TICKET_PREFIXES.includes(prefix)) return null;
  if (prefix === 'pr') return { type: 'pr', value: m[2] };
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

export function extractRefs(text: string): Ref[] {
  const found: { index: number; ref: Ref }[] = [];
  const add = (index: number, ref: Ref) => found.push({ index, ref });

  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g)) {
    const ref = ticketToRef(m[0]);
    if (ref) add(m.index!, ref);
  }
  for (const m of text.matchAll(/\bPR ?#?(\d+)\b/gi)) add(m.index!, { type: 'pr', value: m[1] });
  for (const m of text.matchAll(/#(\d{2,5})\b/g)) add(m.index!, { type: 'pr', value: m[1] });
  for (const m of text.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g)) {
    add(m.index!, { type: 'pr', value: m[3], repo: `${m[1]}/${m[2]}` });
  }
  for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    if (/\d/.test(m[0]) && /[a-f]/.test(m[0])) add(m.index!, { type: 'commit', value: m[0] });
  }
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    const value = m[0].replace(/[).,]+$/, '');
    if (value) add(m.index!, { type: 'url', value });
  }

  // Stable sort keeps pattern order for ties. A repo-aware PR ref sorts before a bare one at the same spot.
  found.sort((a, b) => a.index - b.index);
  return mergeRefs(found.map((f) => f.ref));
}
