import { cleanSearchTerms } from '../core';

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
