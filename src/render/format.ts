import { summarizeLinked } from '../core';
import type { Activity, ActivityCounts } from '../core';

/** Remove control characters before a user-derived or GitHub-derived string reaches a terminal. One helper for every sink. */
export { stripControl } from '../core';

/** Pick the singular or plural word for a count. Style-free: terminal and markdown renderers share it. */
export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "15 commits, 1 PR opened, 2 PRs merged, 4 reviews in 3 repos". Zero counts are left out. */
export function alsoCountsText(c: ActivityCounts): string {
  const parts: string[] = [];
  if (c.commits > 0) parts.push(`${c.commits} ${plural(c.commits, 'commit', 'commits')}`);
  if (c.prsOpened > 0) parts.push(`${c.prsOpened} ${plural(c.prsOpened, 'PR', 'PRs')} opened`);
  if (c.prsMerged > 0) parts.push(`${c.prsMerged} ${plural(c.prsMerged, 'PR', 'PRs')} merged`);
  if (c.reviews > 0) parts.push(`${c.reviews} ${plural(c.reviews, 'review', 'reviews')}`);
  return `${parts.join(', ')} in ${c.repos} ${plural(c.repos, 'repo', 'repos')}`;
}

/** Fold lines under an entry: one per PR with its most advanced event, then the commit count. */
export function foldLines(list: Activity[]): string[] {
  const s = summarizeLinked(list);
  const lines = s.prs.map((p) => `${p.event} #${p.pr}${p.title ? ` ${p.title}` : ''}`);
  if (s.commits > 0) lines.push(`${s.commits} ${plural(s.commits, 'commit', 'commits')}`);
  return lines;
}

export interface AlsoPr { verb: 'merged' | 'reviewed'; ref: string; title: string }

/** Merged PRs, then reviewed PRs, for the collapsed Also form. Opened-only PRs are left out. */
export function alsoPrs(list: Activity[]): AlsoPr[] {
  const prs = summarizeLinked(list).prs
    .filter((p): p is typeof p & { event: 'merged' | 'reviewed' } => p.event !== 'opened')
    .map((p) => ({ verb: p.event, ref: `${p.repo}#${p.pr}`, title: p.title ?? '' }));
  return [...prs.filter((p) => p.verb === 'merged'), ...prs.filter((p) => p.verb === 'reviewed')];
}
