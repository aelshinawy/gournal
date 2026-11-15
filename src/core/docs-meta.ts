// Display text for the configuration keys and environment variables.
// A docs generator renders these descriptors. Keep this file free of I/O.

export interface ConfigKeyDoc {
  key: string;
  type: string;
  default: string;
  description: string;
  validation?: string;
}

export interface EnvVarDoc {
  name: string;
  default: string;
  description: string;
}

export const CONFIG_KEY_DOCS: readonly ConfigKeyDoc[] = [
  {
    key: 'deviceId',
    type: 'string',
    default: 'Generated on first run',
    description: 'Gournal generates this stable id for the machine. Do not change it.',
    validation: 'A non-empty string. Any other value stops gournal with an error.',
  },
  {
    key: 'weekStartsOn',
    type: 'integer',
    default: '1',
    description: 'The first day of the week, from 0 (Sunday) to 6. The `--week` option uses it.',
    validation: 'An integer from 0 to 6. Other values give a warning and the default.',
  },
  {
    key: 'projectAliases',
    type: 'Record<string, string>',
    default: '{}',
    description: 'Maps an old project name to the name to use, for example `{ "old-name": "new-name" }`.',
    validation: 'An object of strings. An alias chain is an error: if `a` maps to `b`, then `b` must not be a key in the same map.',
  },
  {
    key: 'tagAliases',
    type: 'Record<string, string>',
    default: '{}',
    description: 'Maps an old tag to the tag to use, for example `{ "bugfix": "bug" }`.',
    validation: 'An object of strings. An alias chain is an error: if `a` maps to `b`, then `b` must not be a key in the same map.',
  },
  {
    key: 'ticketPrefixes',
    type: 'string[]',
    default: '[]',
    description: 'Lists ticket prefixes, for example `["SBDC", "PLAT"]`. A tag that looks like a ticket becomes a Jira ref only when its prefix is in this list.',
    validation: 'An array of strings. Any other value stops gournal with an error.',
  },
  {
    key: 'staleAfterDays',
    type: 'integer',
    default: '14',
    description: 'The age in days after which an open blocker or next item counts as stale.',
    validation: 'A positive integer. Other values give a warning and the default.',
  },
  {
    key: 'github.autoSync',
    type: 'boolean',
    default: 'true',
    description: 'Turns on auto-sync of GitHub activity.',
    validation: 'true or false. Other values give a warning and the default.',
  },
  {
    key: 'github.autoSyncMinutes',
    type: 'integer',
    default: '15',
    description: 'The number of minutes that auto-sync waits between syncs.',
    validation: 'A positive integer. Other values give a warning and the default.',
  },
  {
    key: 'github.initialSyncDays',
    type: 'integer',
    default: '30',
    description: 'The number of days of GitHub activity that the first sync reads.',
    validation: 'A positive integer. Other values give a warning and the default.',
  },
  {
    key: 'github.owners.include',
    type: 'string[]',
    default: '[]',
    description: 'Limits the sync to these owners (users or organizations).',
    validation: 'An array of strings. Other values give a warning and an empty list.',
  },
  {
    key: 'github.owners.exclude',
    type: 'string[]',
    default: '[]',
    description: 'Skips these owners (users or organizations) in the sync.',
    validation: 'An array of strings. Other values give a warning and an empty list.',
  },
];

export const ENV_VAR_DOCS: readonly EnvVarDoc[] = [
  {
    name: 'GOURNAL_HOME',
    default: '~/.gournal',
    description: 'The folder for all gournal data.',
  },
  {
    name: 'GOURNAL_NO_AUTOSYNC',
    default: 'Not set',
    description: 'Set it to `1` to turn off auto-sync.',
  },
  {
    name: 'GOURNAL_GH',
    default: '`gh` on your `PATH`',
    description: 'The path of the `gh` binary.',
  },
];
