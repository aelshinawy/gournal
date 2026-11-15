export type ActivityType = 'commit' | 'pr_opened' | 'pr_merged' | 'review';

export interface Activity {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string;
  type: ActivityType;
  occurredAt: string;
  repo: string;
  branch: string | null;
  externalId: string;
  title: string | null;
  url: string | null;
  capturedBy: 'github';
  /** Read from payload.pr. */
  pr: number | null;
  payload: Record<string, unknown>;
}

export interface NewActivityInput {
  type: ActivityType;
  occurredAt: string;
  repo: string;
  branch?: string | null;
  externalId: string;
  title?: string | null;
  url?: string | null;
  pr: number | null;
  payload: Record<string, unknown>;
}

export interface ActivityCounts { commits: number; prsOpened: number; prsMerged: number; reviews: number; repos: number }

export function activityCounts(list: Activity[]): ActivityCounts {
  const repos = new Set<string>();
  const reviewed = new Set<string>();
  const counts: ActivityCounts = { commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0, repos: 0 };
  for (const a of list) {
    repos.add(a.repo.toLowerCase());
    if (a.type === 'commit') counts.commits += 1;
    else if (a.type === 'pr_opened') counts.prsOpened += 1;
    else if (a.type === 'pr_merged') counts.prsMerged += 1;
    else reviewed.add(`${a.repo.toLowerCase()}#${a.pr ?? a.externalId}`);
  }
  counts.reviews = reviewed.size;
  counts.repos = repos.size;
  return counts;
}

export interface LinkedSummary {
  prs: { repo: string; pr: number; title: string | null; event: 'merged' | 'opened' | 'reviewed' }[];
  commits: number;
}

const RANK = { reviewed: 0, opened: 1, merged: 2 } as const;

export function summarizeLinked(list: Activity[]): LinkedSummary {
  const sorted = [...list].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const byPr = new Map<string, LinkedSummary['prs'][number]>();
  let commits = 0;
  for (const a of sorted) {
    if (a.type === 'commit') { commits += 1; continue; }
    if (a.pr === null) continue;
    const event = a.type === 'pr_merged' ? 'merged' : a.type === 'pr_opened' ? 'opened' : 'reviewed';
    const key = `${a.repo.toLowerCase()}#${a.pr}`;
    const cur = byPr.get(key);
    if (!cur) byPr.set(key, { repo: a.repo, pr: a.pr, title: a.title, event });
    else {
      if (RANK[event] > RANK[cur.event]) cur.event = event;
      if (cur.title === null && a.title !== null) cur.title = a.title;
    }
  }
  return { prs: [...byPr.values()], commits };
}
