---
title: Customize with config.json
description: Edit config.json to set aliases, ticket prefixes, the week start, and GitHub sync settings.
---

Gournal keeps its settings in `config.json` in the gournal home folder. The default folder is `~/.gournal`. Set `GOURNAL_HOME` to use another folder. Gournal creates the file on first run. Every key is optional. See [Configuration keys](/docs/reference/configuration/) for every key, type, default, and rule.

## An example file

```json
{
  "deviceId": "01K...",
  "projectAliases": { "billing-api": "billing" },
  "tagAliases": { "bugfix": "bug" },
  "ticketPrefixes": ["BILL", "PLAT"],
  "weekStartsOn": 0,
  "staleAfterDays": 7,
  "github": {
    "autoSync": true,
    "autoSyncMinutes": 30,
    "owners": { "include": ["acme"] }
  }
}
```

The `deviceId` is a stable id for this machine. Gournal makes it. Do not change it.

## Project aliases

An alias renames a project when gournal writes an entry and when you filter by `--project`. Existing entries keep the project name that gournal stored. A migration plan applies your current aliases again, but only to entries that came from `entries.json`. The key is the name that gournal finds. The value is the name to use.

```json
{ "projectAliases": { "billing-api": "billing" } }
```

Gournal matches the key against the full repository name (`acme/billing-api`), then the repository name, then the folder name. Matching is not case sensitive. A filter by `--project` also finds old entries that have the old name. See [Projects and identity](/docs/start-here/core-concepts/#projects-and-identity).

## Tag aliases

An alias maps an old tag to the tag to use. The key is the tag in lowercase.

```json
{ "tagAliases": { "bugfix": "bug" } }
```

## Ticket prefixes

A tag such as `bill-12` becomes a ticket ref only when its prefix is in `ticketPrefixes`. See [Tags and refs](/docs/start-here/core-concepts/#tags-and-refs).

```json
{ "ticketPrefixes": ["BILL", "PLAT"] }
```

## Alias chains

An alias must not point to another alias. If `a` maps to `b`, then `b` must not be a key in the same map. Gournal refuses to start in this case. It names the file and does not change it.

```text
Config /Users/you/.gournal/config.json is not valid JSON object: alias chain at "a". Fix or delete it; gournal did not change it.
```

## Reports and sync

The keys `weekStartsOn` and `staleAfterDays` change the reports. The keys under `github` change the sync. See [Configuration keys](/docs/reference/configuration/) for the types and defaults, and [GitHub activity](/docs/guides/github-activity/) for the sync.

A bad value for `weekStartsOn`, `staleAfterDays`, or a `github` key falls back to its default. Gournal prints one warning for each message:

```text
gournal: config /Users/you/.gournal/config.json: staleAfterDays must be a positive integer; using 14
```

## When changes apply

The CLI reads the file each time you run a command. The MCP server reads it once for each process. Restart your MCP clients after you edit the file.

Environment variables are separate from this file. See [Environment variables](/docs/reference/environment/).
