const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Build an FTS5 MATCH expression. Each term becomes a quoted prefix phrase, so no FTS syntax
 * character in user input can change the query. A term with no letter or digit is dropped.
 * An empty result means "match nothing".
 */
export function ftsMatchExpression(terms: string[]): string {
  return terms
    .filter((t) => HAS_WORD_CHAR.test(t))
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}

/** LIKE pattern for a substring match. Use it with ESCAPE '\'. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}
