export type GroupId = 'capture' | 'reports' | 'find' | 'github-agents' | 'data';

export interface Capability {
  /** Page path: reference/<slug>.md */
  slug: string;
  /** Page h1 and sidebar label. */
  title: string;
  group: GroupId;
  /** One or two STE sentences for people. */
  summary: string;
  /** CLI leaf names joined by a space, for example 'index rebuild'. */
  cli: string[];
  /** MCP tool names. */
  mcp: string[];
  /** Shown as a caution aside when set. */
  caution?: string;
  /** Capability slugs or docs paths such as 'guides/github-activity'. */
  related: string[];
}

export const GROUPS: ReadonlyArray<{ id: GroupId; label: string }> = [
  { id: 'capture', label: 'Capture and edit' },
  { id: 'reports', label: 'Reports' },
  { id: 'find', label: 'Find' },
  { id: 'github-agents', label: 'GitHub and agents' },
  { id: 'data', label: 'Data and maintenance' },
];

export const CAPABILITIES: readonly Capability[] = [
  {
    slug: 'add',
    title: 'Add an entry',
    group: 'capture',
    summary: 'Add a journal entry for finished work, a blocker, or a planned next step. Each entry can have tags, references, and details.',
    cli: ['add'],
    mcp: ['add_entry'],
    related: ['resolve', 'guides/logging-with-ai-agents', 'standup'],
  },
  {
    slug: 'edit',
    title: 'Edit an entry',
    group: 'capture',
    summary: 'Change the fields of an entry that exists. Use it to fix a summary, tags, or references.',
    cli: [],
    mcp: ['update_entry'],
    related: ['add', 'remove-restore'],
  },
  {
    slug: 'resolve',
    title: 'Resolve an entry',
    group: 'capture',
    summary: 'Close a blocker or a next item. The entry stops showing as open in reports.',
    cli: ['resolve'],
    mcp: ['resolve_entry'],
    related: ['add', 'standup'],
  },
  {
    slug: 'remove-restore',
    title: 'Remove and restore entries',
    group: 'capture',
    summary: 'Remove an entry, or bring back an entry that you removed. The undo command removes the last entry that you added on this device.',
    cli: ['undo', 'restore'],
    mcp: ['delete_entry'],
    caution: 'A removed entry leaves your reports and searches. The entry stays in the database, and the restore command brings it back. Read the [backups guide](/gournal/docs/guides/data-safety-and-backups/) for backups.',
    related: ['edit', 'guides/data-safety-and-backups'],
  },
  {
    slug: 'standup',
    title: 'Standup report',
    group: 'reports',
    summary: 'Show a standup report for today or for a period that you choose. The report lists what you did, your blockers, and your next steps.',
    cli: ['standup'],
    mcp: ['get_standup'],
    related: ['work-log', 'guides/standups-and-work-logs', 'sync'],
  },
  {
    slug: 'work-log',
    title: 'Work log',
    group: 'reports',
    summary: 'Show a log of your work over a period. Use it to review a week or to write a summary for others.',
    cli: ['log'],
    mcp: ['get_work_log'],
    related: ['standup', 'export', 'guides/standups-and-work-logs'],
  },
  {
    slug: 'stats',
    title: 'Statistics',
    group: 'reports',
    summary: 'Show how many entries you have for each project and tag. The report also shows your daily streak.',
    cli: ['stats'],
    mcp: [],
    related: ['projects', 'tags'],
  },
  {
    slug: 'search',
    title: 'Search entries',
    group: 'find',
    summary: 'Find entries that match a text query. You can narrow the result by project, tag, or period.',
    cli: ['find'],
    mcp: ['find_entries'],
    related: ['list', 'tags', 'projects'],
  },
  {
    slug: 'list',
    title: 'List entries',
    group: 'find',
    summary: 'List journal entries, newest first, with filters. Use it to browse recent work.',
    cli: [],
    mcp: ['list_entries'],
    related: ['search', 'projects'],
  },
  {
    slug: 'projects',
    title: 'Projects',
    group: 'find',
    summary: 'List the projects in your journal with their entry counts.',
    cli: ['projects'],
    mcp: ['list_projects'],
    related: ['tags', 'search'],
  },
  {
    slug: 'tags',
    title: 'Tags',
    group: 'find',
    summary: 'List the tags in your journal with their use counts. Reuse existing tags to keep your journal tidy.',
    cli: ['tags'],
    mcp: ['list_tags'],
    related: ['projects', 'add', 'guides/configuration'],
  },
  {
    slug: 'sync',
    title: 'Sync GitHub activity',
    group: 'github-agents',
    summary: 'Fetch your GitHub activity and link it to your entries. Reports can then show pull requests and reviews next to your work.',
    cli: ['sync'],
    mcp: ['sync_activity'],
    related: ['guides/github-activity', 'standup'],
  },
  {
    slug: 'setup-claude',
    title: 'Set up Claude Code',
    group: 'github-agents',
    summary: 'Connect gournal to Claude Code. The command adds the MCP server, the skill, and an optional hook.',
    cli: ['setup claude'],
    mcp: [],
    related: ['mcp-server', 'guides/claude-code-setup', 'guides/logging-with-ai-agents'],
  },
  {
    slug: 'mcp-server',
    title: 'MCP server',
    group: 'github-agents',
    summary: 'Start the gournal MCP server on standard input and output. AI agents use it to read and write your journal.',
    cli: ['mcp'],
    mcp: [],
    related: ['setup-claude', 'guides/logging-with-ai-agents'],
  },
  {
    slug: 'export',
    title: 'Export entries',
    group: 'data',
    summary: 'Write entries as Markdown or CSV, or write a full bundle for backup and import.',
    cli: ['export'],
    mcp: ['export_entries'],
    related: ['import', 'guides/data-safety-and-backups'],
  },
  {
    slug: 'import',
    title: 'Import entries',
    group: 'data',
    summary: 'Load entries from a bundle file. Use it to restore a journal or to move it to a new machine.',
    cli: ['import'],
    mcp: [],
    caution: 'An import can add to or change the entries that you have. Make a backup first. Read the [backups guide](/gournal/docs/guides/data-safety-and-backups/).',
    related: ['export', 'guides/data-safety-and-backups', 'guides/migrating-from-0x'],
  },
  {
    slug: 'clear',
    title: 'Clear the journal',
    group: 'data',
    summary: 'Remove all journal entries after you confirm.',
    cli: ['clear'],
    mcp: [],
    caution: 'This command removes every entry from your reports and searches. The entries stay in the database until you restore them one by one. Export your journal first. Read the [backups guide](/gournal/docs/guides/data-safety-and-backups/).',
    related: ['export', 'guides/data-safety-and-backups'],
  },
  {
    slug: 'migrate',
    title: 'Migrate from 0.x',
    group: 'data',
    summary: 'Import the old entries.json file into the database, or apply a reviewed migration plan.',
    cli: ['migrate'],
    mcp: [],
    related: ['guides/migrating-from-0x', 'import'],
  },
  {
    slug: 'index-rebuild',
    title: 'Rebuild the search index',
    group: 'data',
    summary: 'Drop and recreate the full-text search index. Run it when search results look wrong.',
    cli: ['index rebuild'],
    mcp: [],
    related: ['search', 'guides/data-safety-and-backups'],
  },
];

const FILE = 'site/scripts/reference/capabilities.ts';

/** Return problems found. An empty list means every command and tool maps to exactly one capability. */
export function checkCoverage(
  cliLeaves: string[],
  mcpTools: string[],
  capabilities: readonly Capability[] = CAPABILITIES,
): string[] {
  const problems: string[] = [];
  const check = (kind: 'CLI command' | 'MCP tool', actual: string[], pick: (c: Capability) => string[]): void => {
    const owners = new Map<string, string[]>();
    for (const c of capabilities) {
      for (const name of pick(c)) owners.set(name, [...(owners.get(name) ?? []), c.slug]);
    }
    for (const name of actual) {
      const slugs = owners.get(name) ?? [];
      if (slugs.length === 0) problems.push(`${kind} "${name}" is not mapped to a capability. Edit ${FILE}.`);
      else if (slugs.length > 1) problems.push(`${kind} "${name}" is mapped twice (${slugs.join(', ')}). Edit ${FILE}.`);
    }
    for (const name of owners.keys()) {
      if (!actual.includes(name)) problems.push(`${kind} "${name}" in ${FILE} does not exist. Remove it or fix the name.`);
    }
  };
  check('CLI command', cliLeaves, (c) => c.cli);
  check('MCP tool', mcpTools, (c) => c.mcp);
  return problems;
}
