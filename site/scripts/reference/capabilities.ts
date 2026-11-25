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
    summary: 'Record finished work, a blocker, or a planned next step. Log each distinct piece of work as its own entry.',
    cli: ['add'],
    mcp: ['add_entry'],
    related: ['resolve', 'guides/logging-with-ai-agents', 'standup'],
  },
  {
    slug: 'edit',
    title: 'Edit an entry',
    group: 'capture',
    summary: 'Fix an entry after you add it, for example a wrong summary, tag, or reference. The CLI has no edit command, so only MCP clients can do this.',
    cli: [],
    mcp: ['update_entry'],
    related: ['add', 'remove-restore'],
  },
  {
    slug: 'resolve',
    title: 'Resolve an entry',
    group: 'capture',
    summary: 'Close a blocker or a planned step when it is cleared or done. The entry then stops showing as open in reports.',
    cli: ['resolve'],
    mcp: ['resolve_entry'],
    related: ['add', 'standup'],
  },
  {
    slug: 'remove-restore',
    title: 'Remove and restore entries',
    group: 'capture',
    summary: 'These commands take an entry out of your reports, or bring it back after a mistake. The undo command takes out the last entry that you added on this device.',
    cli: ['undo', 'restore'],
    mcp: ['delete_entry'],
    caution: 'A removed entry leaves your reports and searches. The entry stays in the database, and the restore command brings it back. Read the [backups guide](/docs/guides/data-safety-and-backups/) for backups.',
    related: ['edit'],
  },
  {
    slug: 'standup',
    title: 'Standup report',
    group: 'reports',
    summary: 'Read this before a standup meeting to see what you finished and what still blocks you. You can choose today, yesterday, or a longer period.',
    cli: ['standup'],
    mcp: ['get_standup'],
    related: ['work-log', 'guides/standups-and-work-logs', 'sync'],
  },
  {
    slug: 'work-log',
    title: 'Work log',
    group: 'reports',
    summary: 'Review what you did over a day or a week. The report helps when you write a weekly summary.',
    cli: ['log'],
    mcp: ['get_work_log'],
    related: ['standup', 'export', 'guides/standups-and-work-logs'],
  },
  {
    slug: 'stats',
    title: 'Statistics',
    group: 'reports',
    summary: 'See where your effort goes and how steady your logging is.',
    cli: ['stats'],
    mcp: [],
    related: ['projects', 'tags'],
  },
  {
    slug: 'search',
    title: 'Search entries',
    group: 'find',
    summary: 'Find an old entry when you remember a word from it. Add filters to narrow a large journal.',
    cli: ['find'],
    mcp: ['find_entries'],
    related: ['tags', 'projects'],
  },
  {
    slug: 'projects',
    title: 'Projects',
    group: 'find',
    summary: 'Check the exact project names in your journal. Reuse a name to keep related entries together.',
    cli: ['projects'],
    mcp: ['list_projects'],
    related: ['tags', 'search'],
  },
  {
    slug: 'tags',
    title: 'Tags',
    group: 'find',
    summary: 'Check the tag names that exist before you add a tag. Reuse them to keep your tags consistent.',
    cli: ['tags'],
    mcp: ['list_tags'],
    related: ['projects', 'add', 'guides/configuration'],
  },
  {
    slug: 'sync',
    title: 'Sync GitHub activity',
    group: 'github-agents',
    summary: 'Fetch your pull requests, commits, and reviews from GitHub. Standup reports then count the activity that no done entry links to.',
    cli: ['sync'],
    mcp: ['sync_activity'],
    related: ['guides/github-activity', 'standup'],
  },
  {
    slug: 'setup-claude',
    title: 'Set up Claude Code',
    group: 'github-agents',
    summary: 'Run this once on each machine where you use Claude Code. Then Claude Code can log your work to the journal.',
    cli: ['setup claude'],
    mcp: [],
    related: ['mcp-server', 'guides/claude-code-setup', 'guides/logging-with-ai-agents'],
  },
  {
    slug: 'mcp-server',
    title: 'MCP server',
    group: 'github-agents',
    summary: 'AI agents use this server to read and write your journal. An MCP client starts it, so you rarely run it yourself.',
    cli: ['mcp'],
    mcp: [],
    related: ['setup-claude', 'guides/logging-with-ai-agents'],
  },
  {
    slug: 'export',
    title: 'Export entries',
    group: 'data',
    summary: 'Make a readable report or a backup copy. The bundle format also moves your journal to another machine.',
    cli: ['export'],
    mcp: ['export_entries'],
    related: ['import', 'guides/data-safety-and-backups'],
  },
  {
    slug: 'import',
    title: 'Import entries',
    group: 'data',
    summary: 'Restore a journal from a backup, or move your journal to a new machine. Bundles from older versions that carry legacyMap still import. Gournal ignores that key.',
    cli: ['import'],
    mcp: [],
    caution: 'An import can add to or change the entries that you have. Make a backup first. Read the [backups guide](/docs/guides/data-safety-and-backups/).',
    related: ['export'],
  },
  {
    slug: 'clear',
    title: 'Clear the journal',
    group: 'data',
    summary: 'Start again with an empty journal. The command asks you to confirm.',
    cli: ['clear'],
    mcp: [],
    caution: 'This command removes every entry from your reports and searches. The entries stay in the database until you restore them one by one. Export your journal first. Read the [backups guide](/docs/guides/data-safety-and-backups/).',
    related: ['export'],
  },
  {
    slug: 'index-rebuild',
    title: 'Rebuild the search index',
    group: 'data',
    summary: 'Rebuild the index when search results look wrong or miss entries that you know exist. The command needs a Node build with FTS5 and refuses to run without it. Your entries stay as they are.',
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
