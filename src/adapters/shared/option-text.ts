import { kindList } from '../../core';

/** Wording that the CLI and the MCP tools share. Each key names one concept. */
export const OPTION_TEXT = Object.freeze({
  project: 'Only entries of this project.',
  repo: 'Only entries of this repository (owner/name).',
  tags: 'Only entries that have all of these tags.',
  from: 'Only entries from this date (inclusive). Use a local day (YYYY-MM-DD) or an ISO timestamp.',
  to: 'Only entries up to this date (inclusive). Use a local day (YYYY-MM-DD) or an ISO timestamp.',
  yesterday: 'Cover yesterday and today.',
  week: 'Cover the current week.',
  month: 'Cover the current month.',
  kind: `Only entries of these kinds: ${kindList()}.`,
  status: 'Only open or only resolved entries.',
  format: 'Output format: md (Markdown) or csv.',
  limit: 'Most entries to return.',
});
