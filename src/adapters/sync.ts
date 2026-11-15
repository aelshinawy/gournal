import { randomBytes } from 'crypto';
import { format } from 'date-fns';
import { InvalidQueryError, parseBound } from '../core';
import { fetchActivity, GhError, type GhRunner } from '../sources';
import type { Journal } from '../storage';

export const SYNC_STATE = {
  login: 'github.login',
  cursor: 'github.cursor',
  lastAttemptAt: 'github.lastAttemptAt',
  lastSyncAt: 'github.lastSyncAt',
} as const;
export const SYNC_LEASE = 'github.sync';
export const AUTO_SYNC_BUDGET_MS = 10_000;

const LEASE_TTL_MS = 120_000;
const AUTO_CALL_TIMEOUT_MS = 10_000;
const MANUAL_CALL_TIMEOUT_MS = 60_000;
const MAX_REASON = 100;
const DAY_MS = 86_400_000;

export interface SyncReport {
  status: 'ok' | 'partial' | 'skipped' | 'failed';
  since: string;
  inserted: number;
  updated: number;
  linked: number;
  /** The one line to print, or null. */
  warning: string | null;
}

type SyncJournal = Pick<Journal, 'repo' | 'activity' | 'config'>;
type Reason = { kind: GhError['kind']; text: string };

function reasonOf(err: unknown, auto: boolean): Reason {
  if (err instanceof GhError) {
    switch (err.kind) {
      case 'auth': return { kind: 'auth', text: 'gh is not signed in; run gh auth login' };
      case 'rate-limit': return { kind: 'rate-limit', text: 'GitHub rate limit reached' };
      case 'timeout': return { kind: 'timeout', text: auto ? 'timed out after 10 s' : 'a GitHub call timed out' };
      case 'network': return { kind: 'network', text: 'no network' };
      case 'missing': return { kind: 'missing', text: 'gh is not installed; see https://cli.github.com' };
      default: return { kind: 'other', text: firstLine(err.message) };
    }
  }
  return { kind: 'other', text: firstLine(err instanceof Error ? err.message : String(err)) };
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? 'unknown error';
  return line.slice(0, MAX_REASON);
}

const skippedLine = (reason: string): string => `gournal: GitHub sync skipped (${reason}); showing stored activity`;

const stoppedLine = (reason: string): string => `gournal: GitHub sync stopped early (${reason}); run gournal sync to catch up`;

/** A local day (YYYY-MM-DD) or an ISO timestamp. Throws a plain Error on a bad value. */
export function parseSince(value: string): Date {
  try {
    return new Date(parseBound(value, 'from'));
  } catch (err) {
    if (err instanceof InvalidQueryError) throw new Error(`Invalid date "${value}". Use YYYY-MM-DD or an ISO timestamp.`);
    throw err;
  }
}

export function syncSummaryLine(r: Pick<SyncReport, 'since' | 'inserted' | 'updated' | 'linked'>): string {
  return `Synced GitHub activity since ${format(new Date(r.since), 'MMM dd')}: ${r.inserted} new, ${r.updated} updated, ${r.linked} links.`;
}

function maxIso(a: string | null, b: string): string {
  if (a === null) return b;
  const x = Date.parse(a);
  return Number.isFinite(x) && x > Date.parse(b) ? a : b;
}

/** Never throws. The result says what happened. */
export async function runSync(
  journal: SyncJournal,
  gh: GhRunner,
  opts: { since?: Date; auto: boolean; now: Date },
): Promise<SyncReport> {
  const { repo, activity, config } = journal;
  const report: SyncReport = { status: 'failed', since: opts.now.toISOString(), inserted: 0, updated: 0, linked: 0, warning: null };
  const owner = `${config.deviceId}:${process.pid}:${randomBytes(4).toString('hex')}`;
  let leased = false;
  try {
    leased = activity.tryLease(SYNC_LEASE, owner, LEASE_TTL_MS);
    if (!leased) {
      return opts.auto
        ? { ...report, status: 'skipped' }
        : { ...report, warning: 'Another GitHub sync is running; try again in a minute.' };
    }
    repo.setState(SYNC_STATE.lastAttemptAt, opts.now.toISOString());
    const cursor = repo.getState(SYNC_STATE.cursor);
    const cursorDate = cursor === null ? null : new Date(cursor);
    const since = opts.since
      ?? (cursorDate !== null && !isNaN(cursorDate.getTime()) ? cursorDate : new Date(opts.now.getTime() - config.github.initialSyncDays * DAY_MS));
    report.since = since.toISOString();

    const fetched = await fetchActivity(gh, {
      since,
      login: repo.getState(SYNC_STATE.login) ?? undefined,
      owners: config.github.owners,
      deadline: opts.auto ? Date.now() + AUTO_SYNC_BUDGET_MS : undefined,
      callTimeoutMs: opts.auto ? AUTO_CALL_TIMEOUT_MS : MANUAL_CALL_TIMEOUT_MS,
    });
    repo.transaction(() => {
      const up = activity.upsert(fetched.items);
      report.inserted = up.inserted;
      report.updated = up.updated;
      report.linked = activity.relinkActivity(up.ids);
      repo.setState(SYNC_STATE.login, fetched.login);
      // A --since later than the cursor must leave it, or the gap before --since is never fetched.
      const cursorOk = cursorDate === null || isNaN(cursorDate.getTime()) || since.getTime() <= cursorDate.getTime();
      if (fetched.complete) {
        if (cursorOk) repo.setState(SYNC_STATE.cursor, maxIso(cursor, opts.now.toISOString()));
        repo.setState(SYNC_STATE.lastSyncAt, opts.now.toISOString());
      } else if (cursorOk && fetched.progressAt !== null) {
        // A partial sync moves the cursor to the last PR that finished, and never back.
        // The PRs come in ascending updated order, so the next sync continues there.
        const at = Date.parse(fetched.progressAt);
        const stored = cursorDate === null ? NaN : cursorDate.getTime();
        if (Number.isFinite(at) && !(at <= stored)) repo.setState(SYNC_STATE.cursor, fetched.progressAt);
      }
    });
    if (fetched.complete) return { ...report, status: 'ok' };
    const why = reasonOf(new GhError(fetched.stoppedBy ?? 'other', 'stopped'), opts.auto).text;
    const warning = !opts.auto
      ? `Stopped early (${why}); run gournal sync again to continue.`
      : fetched.progressAt !== null ? stoppedLine(why) : skippedLine(why);
    return { ...report, status: 'partial', warning };
  } catch (err) {
    const reason = reasonOf(err, opts.auto);
    // Without gh, an auto sync stays silent: the user has not set up GitHub.
    if (opts.auto) return { ...report, status: 'failed', warning: reason.kind === 'missing' ? null : skippedLine(reason.text) };
    return { ...report, status: 'failed', warning: `GitHub sync failed (${reason.text})` };
  } finally {
    if (leased) {
      try { activity.releaseLease(SYNC_LEASE, owner); } catch { /* a stale lease expires after its TTL */ }
    }
  }
}

/** Null when no sync was due, or it ran with no warning, or gh is missing. Never throws. */
export async function maybeAutoSync(journal: SyncJournal, gh: GhRunner, now: Date): Promise<string | null> {
  try {
    const { github } = journal.config;
    if (!github.autoSync || process.env.GOURNAL_NO_AUTOSYNC === '1') return null;
    const last = journal.repo.getState(SYNC_STATE.lastAttemptAt);
    const lastMs = last === null ? NaN : Date.parse(last);
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < github.autoSyncMinutes * 60_000) return null;
    return (await runSync(journal, gh, { auto: true, now })).warning;
  } catch {
    return null;
  }
}

let relinkWarned = false;

/** Call after the entry write has committed. Never throws. On failure it writes one stderr warning per process. */
export function relinkAfterWrite(journal: Pick<Journal, 'activity'>, entryIds: string[]): void {
  if (entryIds.length === 0) return;
  try {
    journal.activity.relinkEntries(entryIds);
  } catch (err) {
    if (relinkWarned) return;
    relinkWarned = true;
    try { process.stderr.write(`gournal: relink after write failed (${firstLine(err instanceof Error ? err.message : String(err))})\n`); } catch { /* ignore */ }
  }
}
