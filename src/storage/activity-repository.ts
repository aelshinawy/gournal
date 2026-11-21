import type { DatabaseSync } from 'node:sqlite';
import { BRANCH_WINDOW_MS, matchLinks, newId } from '../core';
import type { Activity, ActivityQuery, ActivityRepository, Config, Entry, LinkCandidate, NewActivityInput } from '../core';
import { BUMP_UPDATED_AT, createWriter } from './writer';
import type { Writer } from './writer';
import { chunks, hydrateRows, marks, parseTime } from './entry-rows';
import type { Row } from './entry-rows';
import { payloadText, rowToActivity } from './activity-rows';
import type { ActivityRow } from './activity-rows';

const MIN_SHA = 7;
const HEX = /^[0-9a-f]+$/;

/** Pass the writer that the entry repository uses, so both share one transaction state per connection. */
export function createActivityRepository(db: DatabaseSync, config: Config, dbPath: string | null, writer: Writer = createWriter(db, dbPath)): ActivityRepository {
  const write = <T>(fn: () => T, opts?: { backup?: boolean }): T => writer.write(fn, opts);

  const liveActivity = (rows: ActivityRow[]): Activity[] => rows.map(rowToActivity);

  function liveEntries(ids: string[]): Entry[] {
    const out: Entry[] = [];
    for (const part of chunks(ids)) {
      const rows = db.prepare(`SELECT * FROM entries WHERE deleted_at IS NULL AND id IN (${marks(part.length)})`).all(...part) as unknown as Row[];
      out.push(...hydrateRows(db, rows));
    }
    return out;
  }

  /** Live done entries on this repo and branch that were created within the branch window of `at`. */
  function doneEntriesNear(repo: string, branch: string, at: number): string[] {
    return (db.prepare(`SELECT id FROM entries WHERE deleted_at IS NULL AND kind = 'done' AND repo = ? COLLATE NOCASE AND branch = ?
      AND created_at BETWEEN ? AND ?`).all(repo, branch, at - BRANCH_WINDOW_MS, at + BRANCH_WINDOW_MS) as { id: string }[]).map((r) => r.id);
  }

  /**
   * Load the sets that matchLinks needs for the `scope` entries, then match.
   * The activity set holds every live activity with each PR number the scope refs, every commit that
   * matches a sha ref, and the branch activity near each scope entry. The entry set holds the scope and
   * every live done entry near each loaded activity that has a branch.
   */
  function matchScope(scope: Entry[]): LinkCandidate[] {
    const acts = new Map<string, Activity>();
    const take = (rows: ActivityRow[]): void => { for (const r of rows) if (!acts.has(r.id)) acts.set(r.id, rowToActivity(r)); };
    const prs = new Set<number>();
    const shas = new Set<string>();
    for (const e of scope) {
      for (const ref of e.refs) {
        if (ref.type === 'pr') {
          const m = /^#?(\d+)$/.exec(ref.value.trim());
          if (m) prs.add(Number(m[1]));
        } else if (ref.type === 'commit') {
          const sha = ref.value.trim().toLowerCase();
          if (sha.length >= MIN_SHA && HEX.test(sha)) shas.add(sha);
        }
      }
    }
    for (const part of chunks([...prs])) {
      take(db.prepare(`SELECT * FROM activity WHERE deleted_at IS NULL AND json_extract(payload, '$.pr') IN (${marks(part.length)})`).all(...part) as unknown as ActivityRow[]);
    }
    for (const sha of shas) {
      take(db.prepare("SELECT * FROM activity WHERE deleted_at IS NULL AND type = 'commit' AND external_id LIKE ? || '%'").all(sha) as unknown as ActivityRow[]);
    }
    for (const e of scope) {
      if (e.kind !== 'done' || !e.repo || !e.branch) continue;
      const at = Date.parse(e.createdAt);
      take(db.prepare(`SELECT * FROM activity WHERE deleted_at IS NULL AND repo = ? COLLATE NOCASE AND branch = ?
        AND occurred_at BETWEEN ? AND ?`).all(e.repo, e.branch, at - BRANCH_WINDOW_MS, at + BRANCH_WINDOW_MS) as unknown as ActivityRow[]);
    }
    const entries = new Map<string, Entry>(scope.map((e) => [e.id, e]));
    const nearIds = new Set<string>();
    for (const a of acts.values()) {
      if (a.branch) for (const id of doneEntriesNear(a.repo, a.branch, Date.parse(a.occurredAt))) if (!entries.has(id)) nearIds.add(id);
    }
    for (const e of liveEntries([...nearIds])) entries.set(e.id, e);
    return matchLinks({ entries: [...entries.values()], activity: [...acts.values()], weekStartsOn: config.weekStartsOn });
  }

  /** Insert each pair that has no live link yet. Runs inside a write. Returns the number added. */
  function addLinks(found: LinkCandidate[]): number {
    const exists = db.prepare('SELECT 1 AS x FROM links WHERE entry_id = ? AND activity_id = ? AND deleted_at IS NULL LIMIT 1');
    const insert = db.prepare('INSERT INTO links (id, entry_id, activity_id, reason, created_at, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const now = Date.now();
    let added = 0;
    for (const c of found) {
      if (exists.get(c.entryId, c.activityId)) continue;
      insert.run(newId(now), c.entryId, c.activityId, c.reason, now, now, config.deviceId);
      added += 1;
    }
    return added;
  }

  return {
    upsert(items: NewActivityInput[]) {
      return write(() => {
        const now = Date.now();
        const insert = db.prepare(`INSERT INTO activity (id, created_at, updated_at, device_id, type, occurred_at, repo, branch, external_id,
          title, url, captured_by, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'github', ?)
          ON CONFLICT(type, repo, external_id) DO NOTHING`);
        // updated_at rises strictly, and only when a stored field differs.
        const update = db.prepare(`UPDATE activity SET occurred_at = ?, branch = ?, title = ?, url = ?, payload = ?, ${BUMP_UPDATED_AT}
          WHERE type = ? AND repo = ? AND external_id = ?
          AND (occurred_at IS NOT ? OR branch IS NOT ? OR title IS NOT ? OR url IS NOT ? OR payload IS NOT ?)`);
        const idOf = db.prepare('SELECT id FROM activity WHERE type = ? AND repo = ? AND external_id = ?');
        let inserted = 0;
        let updated = 0;
        const ids: string[] = [];
        for (const it of items) {
          const occurred = parseTime(it.occurredAt, 'occurredAt');
          const branch = it.branch ?? null;
          const title = it.title ?? null;
          const url = it.url ?? null;
          const payload = payloadText(it.payload, it.pr);
          const made = insert.run(newId(now), now, now, config.deviceId, it.type, occurred, it.repo, branch, it.externalId, title, url, payload);
          if (Number(made.changes) > 0) inserted += 1;
          else if (Number(update.run(occurred, branch, title, url, payload, now, it.type, it.repo, it.externalId,
            occurred, branch, title, url, payload).changes) > 0) updated += 1;
          ids.push((idOf.get(it.type, it.repo, it.externalId) as { id: string }).id);
        }
        return { inserted, updated, ids };
      });
    },

    find(q: ActivityQuery = {}) {
      const where = ['deleted_at IS NULL'];
      const vals: (string | number)[] = [];
      if (q.from !== undefined) { where.push('occurred_at >= ?'); vals.push(parseTime(q.from, 'from')); }
      if (q.to !== undefined) { where.push('occurred_at <= ?'); vals.push(parseTime(q.to, 'to')); }
      if (q.repo !== undefined) { where.push('repo = ? COLLATE NOCASE'); vals.push(q.repo); }
      if (q.types) {
        if (q.types.length === 0) where.push('0');
        else { where.push(`type IN (${marks(q.types.length)})`); vals.push(...q.types); }
      }
      if (q.linked !== undefined) {
        // A link counts only while its entry is live. Deleting an entry does not delete its links.
        where.push(`${q.linked ? '' : 'NOT '}EXISTS (SELECT 1 FROM links l JOIN entries e ON e.id = l.entry_id
          WHERE l.activity_id = activity.id AND l.deleted_at IS NULL AND e.deleted_at IS NULL)`);
      }
      return liveActivity(db.prepare(`SELECT * FROM activity WHERE ${where.join(' AND ')} ORDER BY occurred_at, id`).all(...vals) as unknown as ActivityRow[]);
    },

    linkedTo(entryIds) {
      const out: Record<string, Activity[]> = {};
      for (const part of chunks(entryIds)) {
        const rows = db.prepare(`SELECT l.entry_id AS entry_id, a.* FROM links l JOIN activity a ON a.id = l.activity_id JOIN entries e ON e.id = l.entry_id
          WHERE l.deleted_at IS NULL AND a.deleted_at IS NULL AND e.deleted_at IS NULL AND l.entry_id IN (${marks(part.length)})
          ORDER BY a.occurred_at, a.id`).all(...part) as unknown as (ActivityRow & { entry_id: string })[];
        for (const r of rows) (out[r.entry_id] ?? (out[r.entry_id] = [])).push(rowToActivity(r));
      }
      return out;
    },

    relinkEntries(entryIds) {
      const ids = [...new Set(entryIds)];
      if (ids.length === 0) return 0;
      return write(() => {
        const scope = liveEntries(ids);
        const scopeIds = new Set(ids);
        const found = matchScope(scope).filter((c) => scopeIds.has(c.entryId));
        const keep = new Set(found.map((c) => `${c.entryId}\u0000${c.activityId}`));
        const stale: string[] = [];
        for (const part of chunks(ids)) {
          const live = db.prepare(`SELECT id, entry_id, activity_id FROM links WHERE deleted_at IS NULL AND entry_id IN (${marks(part.length)})`)
            .all(...part) as { id: string; entry_id: string; activity_id: string }[];
          for (const l of live) if (!keep.has(`${l.entry_id}\u0000${l.activity_id}`)) stale.push(l.id);
        }
        const now = Date.now();
        const drop = db.prepare(`UPDATE links SET deleted_at = ?, ${BUMP_UPDATED_AT} WHERE id = ? AND deleted_at IS NULL`);
        for (const id of stale) drop.run(now, now, id);
        return addLinks(found);
      });
    },

    relinkActivity(activityIds) {
      const ids = [...new Set(activityIds)];
      if (ids.length === 0) return 0;
      return write(() => {
        const targets: Activity[] = [];
        for (const part of chunks(ids)) {
          targets.push(...liveActivity(db.prepare(`SELECT * FROM activity WHERE deleted_at IS NULL AND id IN (${marks(part.length)})`).all(...part) as unknown as ActivityRow[]));
        }
        // The entries that may link to a target. matchScope then loads the complete sets for them.
        const entryIds = new Set<string>();
        const byRef = db.prepare(`SELECT DISTINCT e.id AS id FROM entries e JOIN entry_refs r ON r.entry_id = e.id
          WHERE e.deleted_at IS NULL AND r.type = 'pr' AND trim(r.value) IN (?, ?)`);
        const bySha = db.prepare(`SELECT DISTINCT e.id AS id FROM entries e JOIN entry_refs r ON r.entry_id = e.id
          WHERE e.deleted_at IS NULL AND r.type = 'commit' AND length(trim(r.value)) >= ${MIN_SHA}
          AND substr(?, 1, length(trim(r.value))) = lower(trim(r.value))`);
        for (const a of targets) {
          if (a.pr !== null) for (const r of byRef.all(String(a.pr), `#${a.pr}`) as { id: string }[]) entryIds.add(r.id);
          if (a.type === 'commit') for (const r of bySha.all(a.externalId.toLowerCase()) as { id: string }[]) entryIds.add(r.id);
          if (a.branch) for (const id of doneEntriesNear(a.repo, a.branch, Date.parse(a.occurredAt))) entryIds.add(id);
        }
        if (entryIds.size === 0) return 0;
        const targetIds = new Set(targets.map((a) => a.id));
        return addLinks(matchScope(liveEntries([...entryIds])).filter((c) => targetIds.has(c.activityId)));
      });
    },

    tryLease(name, owner, ttlMs) {
      return write(() => {
        const key = `lease:${name}`;
        const now = Date.now();
        const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string | null } | undefined;
        if (row?.value) {
          const cut = row.value.lastIndexOf(' ');
          const heldBy = row.value.slice(0, cut);
          const expires = Number(row.value.slice(cut + 1));
          if (heldBy !== owner && Number.isFinite(expires) && now < expires) return false;
        }
        db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(key, `${owner} ${now + ttlMs}`);
        return true;
      }, { backup: false });
    },

    releaseLease(name, owner) {
      write(() => {
        const key = `lease:${name}`;
        const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string | null } | undefined;
        if (row?.value && row.value.slice(0, row.value.lastIndexOf(' ')) === owner) db.prepare('DELETE FROM sync_state WHERE key = ?').run(key);
      }, { backup: false });
    },
  };
}
