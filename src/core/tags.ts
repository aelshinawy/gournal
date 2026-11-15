import type { Ref } from './types';
import { mergeRefs, ticketToRef, type TicketOptions } from './refs';

export function normalizeTags(raw: string[], aliases: Record<string, string> = {}, opts: TicketOptions = {}): { tags: string[]; refs: Ref[] } {
  const tags: string[] = [];
  const refs: Ref[] = [];
  for (const item of raw) {
    let tag = item.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag) continue;
    const ref = ticketToRef(tag, opts);
    if (ref) {
      refs.push(ref);
      continue;
    }
    tag = Object.hasOwn(aliases, tag) ? aliases[tag] : tag;
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return { tags, refs: mergeRefs(refs) };
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function closeTags(tag: string, existing: string[], max = 3): string[] {
  if (existing.includes(tag)) return [];
  const scored: { name: string; dist: number }[] = [];
  for (const name of new Set(existing)) {
    const dist = tag.length >= 4 && name.length >= 4 ? distance(tag, name) : Infinity;
    const [short, long] = tag.length <= name.length ? [tag, name] : [name, tag];
    const prefix = short.length >= 4 && long.startsWith(short);
    if (dist <= 2 || prefix) scored.push({ name, dist });
  }
  scored.sort((a, b) => a.dist - b.dist || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return scored.slice(0, max).map((s) => s.name);
}
