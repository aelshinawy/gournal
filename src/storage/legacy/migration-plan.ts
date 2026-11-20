import type { DatabaseSync } from 'node:sqlite';
import { checkSummary, KINDS, mergeRefs, normalizeTags, resolveProjectAlias } from '../../core';
import type { Entry, EntryPatch, Kind, Ref } from '../../core';
import type { EntryRepository } from '../../core';
import type { Config } from '../../core';
import { snapshotDb } from '../backup';
import { readLegacyEntriesSync } from './legacy-json';
import { importLegacy, sanitize, sha256 } from './legacy-import';

export interface PlanItem {
  index: number;
  timestamp: string;
  messageHash: string;
  summary: string;
  details?: string | null;
  kind?: Kind;
  tags?: string[];
  project?: string;
}

export interface MigrationPlan {
  format: 'gournal-migration-plan';
  version: 1;
  items: PlanItem[];
}

type PlanView = Pick<Entry, 'summary' | 'details' | 'kind' | 'project' | 'tags' | 'refs'>;

interface PlanChange {
  entryId: string;
  index: number;
  /** The legacy timestamp as written. */
  timestamp: string;
  before: PlanView;
  after: PlanView;
}

const view = (e: Entry): PlanView => ({ summary: e.summary, details: e.details, kind: e.kind, project: e.project, tags: e.tags, refs: e.refs });
/** True when the original message (trimmed) is still in the summary or in the details. */
const keepsText = (message: string, summary: string, details: string | null): boolean => {
  const msg = message.trim();
  return summary.includes(msg) || (details ?? '').includes(msg);
};
const sameList = (a: unknown[], b: unknown[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

interface Resolved { item: PlanItem; entryId: string; message: string; summary: string }

/** Check the whole plan against entries.json and legacy_map. Throws on the first failure. Writes nothing. */
function validatePlan(db: DatabaseSync, jsonPath: string, plan: MigrationPlan): Resolved[] {
  if (typeof plan !== 'object' || plan === null || plan.format !== 'gournal-migration-plan'
    || plan.version !== 1 || !Array.isArray(plan.items)) {
    throw new Error('Not a gournal migration plan');
  }
  const legacy = readLegacyEntriesSync(jsonPath).map(sanitize);
  const find = db.prepare(
    'SELECT m.entry_id FROM legacy_map m JOIN entries e ON e.id = m.entry_id WHERE m.legacy_index = ? AND m.message_hash = ? AND m.timestamp = ?'
  );
  const seen = new Set<number>();
  const out: Resolved[] = [];
  for (const [position, item] of plan.items.entries()) {
    if (typeof item !== 'object' || item === null) throw new Error(`Plan item ${position} is not an object`);
    const i = (item as PlanItem | null)?.index as number;
    const mismatch = () => new Error(`Plan item ${i} does not match entries.json; nothing was written`);
    if (!Number.isInteger(i) || i < 0 || i >= legacy.length) throw mismatch();
    const src = legacy[i];
    if (item.timestamp !== src.timestamp || item.messageHash !== sha256(src.message)) throw mismatch();
    const row = find.get(i, item.messageHash, src.timestamp) as { entry_id: string } | undefined;
    if (!row) throw mismatch();
    if (seen.has(i)) throw new Error(`Plan item ${i} appears more than once`);
    seen.add(i);
    if (typeof item.summary !== 'string') throw new Error(`Plan item ${i} summary must be a string`);
    const check = checkSummary(item.summary, null, { allowSplit: false });
    if (!check.ok) throw new Error(`Plan item ${i} ${check.error}`);
    if (check.summary.length === 0) throw new Error(`Plan item ${i} summary is empty`);
    if (item.kind !== undefined && !(KINDS as readonly string[]).includes(item.kind)) throw new Error(`Plan item ${i} kind is not valid`);
    if (item.tags !== undefined && !(Array.isArray(item.tags) && item.tags.every((t) => typeof t === 'string'))) {
      throw new Error(`Plan item ${i} tags must be an array of strings`);
    }
    if (item.project !== undefined && (typeof item.project !== 'string' || item.project.trim().length === 0)) {
      throw new Error(`Plan item ${i} project must be a non-empty string`);
    }
    if (item.details !== undefined && item.details !== null && typeof item.details !== 'string') {
      throw new Error(`Plan item ${i} details must be a string or null`);
    }
    if (item.details === null && check.summary !== src.message.trim()) {
      throw new Error(`Plan item ${i} would lose text: details may only be cleared when the summary is the full message`);
    }
    if (typeof item.details === 'string' && !keepsText(src.message, check.summary, item.details)) {
      throw new Error(`Plan item ${i} would lose text: summary plus details must contain the original message`);
    }
    out.push({ item, entryId: row.entry_id, message: src.message, summary: check.summary });
  }
  return out;
}

/**
 * Apply a reviewed plan. First imports any new legacy items. Then it validates every item,
 * and only then writes, in one transaction. It also re-applies the current aliases and ticket
 * prefixes to every migrated entry. With dryRun it computes the changes and writes nothing.
 */
export function applyPlan(
  db: DatabaseSync,
  repo: EntryRepository,
  config: Config,
  jsonPath: string,
  plan: MigrationPlan,
  opts: { dryRun: boolean }
): { changes: PlanChange[]; snapshot?: string } {
  importLegacy(db, repo, config, jsonPath);
  const resolved = validatePlan(db, jsonPath, plan);
  // A real run keeps a copy of the database before it writes, so a bad plan can be undone.
  // The copy comes after validation, so a plan that fails leaves no snapshot.
  let snapshot: string | undefined;
  if (!opts.dryRun) {
    const main = (db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]).find((r) => r.name === 'main');
    if (main?.file) snapshot = snapshotDb(db, main.file);
  }
  const byEntry = new Map(resolved.map((r) => [r.entryId, r]));
  const origin = new Map(
    (db.prepare('SELECT legacy_index, timestamp, entry_id FROM legacy_map ORDER BY legacy_index DESC').all() as
      { legacy_index: number; timestamp: string; entry_id: string }[])
      .map((r) => [r.entry_id, r] as const)
  );
  const aliasProject = (p: string) => resolveProjectAlias(p, config.projectAliases);

  const planAll = (): { change: PlanChange; patch: EntryPatch }[] => {
    const planned: { change: PlanChange; patch: EntryPatch }[] = [];
    for (const row of repo.find({ includeDeleted: true })) {
      const r = byEntry.get(row.id);
      if (!r && row.source !== 'migration') continue;
      const wantTags = r?.item.tags ?? row.tags;
      const norm = normalizeTags(wantTags, config.tagAliases, { ticketPrefixes: config.ticketPrefixes });
      const wantProject = r?.item.project ?? row.project;
      const newRefs = mergeRefs(row.refs, norm.refs);
      const tagsPatched = !sameList(norm.tags, row.tags) || newRefs.length !== row.refs.length;
      let details = r && r.item.details !== undefined ? r.item.details : row.details;
      if (r && r.item.details === undefined && !keepsText(r.message, r.summary, details)) {
        // A new summary must not drop the original words. Put the message first, then any edited details.
        const msg = r.message.trim();
        details = details !== null && details !== '' && details !== msg ? `${msg}\n\n${details}` : msg;
      }
      const after: PlanView = {
        summary: r ? r.summary : row.summary,
        details,
        kind: r?.item.kind ?? row.kind,
        // The repository aliases the project once. The patch carries the raw value.
        project: aliasProject(wantProject),
        tags: norm.tags,
        refs: tagsPatched ? newRefs : row.refs,
      };
      const before = view(row);
      const patch: EntryPatch = {};
      if (after.summary !== before.summary) patch.summary = after.summary;
      if (after.details !== before.details) patch.details = after.details;
      if (after.project !== before.project) patch.project = wantProject;
      if (tagsPatched) patch.tags = wantTags;
      if (after.kind !== before.kind) patch.kind = after.kind;
      if (Object.keys(patch).length === 0) continue;
      const o = origin.get(row.id);
      planned.push({ change: { entryId: row.id, index: o?.legacy_index ?? -1, timestamp: o?.timestamp ?? row.createdAt, before, after }, patch });
    }
    return planned;
  };

  let planned: { change: PlanChange; patch: EntryPatch }[];
  if (opts.dryRun) {
    planned = planAll();
  } else {
    // Plan from rows read inside the write lock, so a concurrent write is never overwritten with stale values.
    planned = repo.transaction(() => {
      const list = planAll();
      for (const p of list) repo.update(p.change.entryId, p.patch);
      return list;
    });
  }
  return { changes: planned.map((p) => p.change), ...(snapshot ? { snapshot } : {}) };
}

/** Markdown for a dry run: one section per change. */
export function renderPlanDiff(changes: PlanChange[]): string {
  const block = (label: string, v: PlanView): string => [
    `**${label}**`,
    '',
    '```',
    `summary: ${v.summary}`,
    `details: ${v.details === null ? '(none)' : v.details}`,
    `kind: ${v.kind}`,
    `project: ${v.project}`,
    `tags: ${v.tags.join(', ')}`,
    'refs:',
    ...v.refs.map((r: Ref) => `  ${r.type}:${r.value}${r.repo ? ` (${r.repo})` : ''}`),
    '```',
  ].join('\n');
  return changes.map((c) => `### ${c.index} ${c.timestamp}\n\n${block('before', c.before)}\n\n${block('after', c.after)}\n`).join('\n');
}
