import type { DatabaseSync } from 'node:sqlite';
import { cleanSearchTerms, resolveQuery } from '../core';
import type { Config, Query } from '../core';
import { searchIndexLive } from './search-index';

/**
 * Build an FTS5 MATCH expression. Each term becomes a quoted prefix phrase, so no FTS syntax
 * character in user input can change the query. A term with no letter or digit is dropped.
 * An empty result means "match nothing".
 * resolveQuery already cleans the terms (control characters, no-word terms), so both search modes see the
 * same terms. The cleaning here is a second guard for direct callers.
 */
export function ftsMatchExpression(terms: string[]): string {
  return cleanSearchTerms(terms)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}

/** LIKE pattern for a substring match. Use it with ESCAPE '\'. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** One WHERE clause for find and the counts. Order and limit come back for find only. */
export function buildEntryWhere(
  db: DatabaseSync, q: Query, config: Config, normalize: (tags: string[]) => { tags: string[] },
): { where: string; vals: (string | number)[]; order: 'ASC' | 'DESC'; limit?: number } {
  const r = resolveQuery(q, config.projectAliases);
  const where: string[] = [];
  const vals: (string | number)[] = [];
  if (!r.includeDeleted) where.push('entries.deleted_at IS NULL');
  if (r.projects) {
    where.push(`entries.project COLLATE NOCASE IN (${r.projects.map(() => '?').join(', ')})`);
    vals.push(...r.projects);
  }
  if (r.repo !== undefined) { where.push('entries.repo = ? COLLATE NOCASE'); vals.push(r.repo); }
  if (r.kind) { where.push(`entries.kind IN (${r.kind.map(() => '?').join(', ')})`); vals.push(...r.kind); }
  if (r.status !== undefined) { where.push('entries.status = ?'); vals.push(r.status); }
  if (r.source !== undefined) { where.push('entries.source = ?'); vals.push(r.source); }
  for (const tag of r.tags ?? []) {
    // Same normalization as add. A ticket-shaped tag is stored as a ref, so no tag can match it.
    const [norm] = normalize([tag]).tags;
    if (norm === undefined) { where.push('0'); continue; }
    where.push('EXISTS (SELECT 1 FROM entry_tags ft WHERE ft.entry_id = entries.id AND ft.tag = ?)');
    vals.push(norm);
  }
  if (r.fromMs !== undefined) { where.push('entries.created_at >= ?'); vals.push(r.fromMs); }
  if (r.toMs !== undefined) { where.push('entries.created_at <= ?'); vals.push(r.toMs); }
  if (r.terms && r.terms.length === 0) {
    where.push('0');
  } else if (r.terms) {
    if (searchIndexLive(db)) {
      const expr = ftsMatchExpression(r.terms);
      if (expr === '') where.push('0');
      else { where.push('entries.rowid IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)'); vals.push(expr); }
    } else {
      for (const term of r.terms) {
        where.push("(entries.summary || char(10) || coalesce(entries.details, '')) LIKE ? ESCAPE '\\'");
        vals.push(likePattern(term));
      }
    }
  }
  return { where: where.length ? where.join(' AND ') : '1', vals, order: r.order === 'desc' ? 'DESC' : 'ASC', limit: r.limit };
}
