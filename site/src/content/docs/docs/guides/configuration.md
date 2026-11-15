---
title: Configuration
description: Edit config.json to set aliases, ticket prefixes, the week start, and GitHub sync settings.
---

Gournal keeps its settings in `config.json` in the gournal home folder. The default folder is `~/.gournal`. Set `GOURNAL_HOME` to use another folder. Gournal creates the file on first run. Every key is optional. See [Configuration keys](/gournal/docs/reference/configuration/) for every key, type, default, and rule.

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

Gournal matches the key against the full repository name (`acme/billing-api`), then the repository name, then the folder name. Matching is not case sensitive. A filter by `--project` also finds old entries that have the old name. See [Projects and identity](/gournal/docs/start-here/core-concepts/#projects-and-identity).

## Tag aliases

An alias maps an old tag to the tag to use. The key is the tag in lowercase.

```json
{ "tagAliases": { "bugfix": "bug" } }
```

## Ticket prefixes

A tag such as `bill-12` looks like a ticket. Gournal turns it into a ticket ref (`BILL-12`) only when its prefix is in `ticketPrefixes`. A tag such as `pr-42` always becomes a pull request ref. See [Tags and refs](/gournal/docs/start-here/core-concepts/#tags-and-refs).

```json
{ "ticketPrefixes": ["BILL", "PLAT"] }
```

## Alias chains

An alias must not point to another alias. If `a` maps to `b`, then `b` must not be a key in the same map. Gournal refuses to start in this case. It names the file and does not change it.

```text
Config /Users/you/.gournal/config.json is not valid JSON object: alias chain at "a". Fix or delete it; gournal did not change it.
```

## Reports and sync

1. `weekStartsOn`: the first day of the week, from 0 (Sunday) to 6. The default is 1 (Monday). The option `--week` uses it.
2. `staleAfterDays`: the age after which an open blocker or next item counts as stale. The default is 14.
3. `github.autoSync`, `github.autoSyncMinutes`, `github.initialSyncDays`, and `github.owners`: see [GitHub activity](/gournal/docs/guides/github-activity/).

A bad value for `weekStartsOn`, `staleAfterDays`, or a `github` key falls back to its default. Gournal prints one warning for each message:

```text
gournal: config /Users/you/.gournal/config.json: staleAfterDays must be a positive integer; using 14
```

## When changes apply

The CLI reads the file each time you run a command. The MCP server reads it once for each process. Restart your MCP clients after you edit the file.

Environment variables are separate from this file. See [Environment variables](/gournal/docs/reference/environment/).
