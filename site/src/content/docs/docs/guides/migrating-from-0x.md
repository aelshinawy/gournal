---
title: Migrating from 0.x
description: Move from 0.5 and 0.6 to the SQLite database, and rewrite old entries with a reviewed plan.
---

Versions 0.5 and 0.6 kept your entries in a file named `entries.json`. Version 0.7 moved them to a SQLite database. This page explains what happens when you upgrade to 0.9, and how to clean up old entries with a migration plan.

## What happens when you upgrade

Gournal imports `entries.json` for you. Each time gournal opens the journal and finds `entries.json`, it imports every line that it has not imported yet. When it imports new lines, it prints a line on stderr:

```text
gournal: imported 2 entries from entries.json
```

Gournal never writes to `entries.json`. You can keep the file. Gournal skips lines that it already knows.

Gournal converts each line in a simple way:

1. The first sentence becomes the summary. Gournal shortens it to 120 characters with `...` when needed.
2. The full text goes to `details` when the summary is shorter than the text.
3. The kind is `done`. The source is `migration`.
4. Tags go through your tag aliases. A tag such as `pr-42` becomes a ref. Refs in the text also become refs.
5. The project goes through your project aliases.

To import on request, run `gournal migrate`:

```console
$ gournal migrate
Imported 0 entries (2 already present).
```

## Restart your MCP clients

After an upgrade from 0.6.x or older, restart your MCP clients. Old servers keep running. They write to `entries.json`, not to the database. Run `gournal migrate` to import those late entries.

## Aliases

Old entries often have project names and tags that you want to change. Set aliases in `config.json`. They apply to migrated entries and to new entries.

```json
{
  "projectAliases": { "old-name": "new-name" },
  "tagAliases": { "bugfix": "bug" },
  "ticketPrefixes": ["SBDC"]
}
```

See [Configuration](/gournal/docs/guides/configuration/).

## Migration plans

The simple conversion keeps only the first sentence as the summary. A migration plan lets you write better summaries. You review the plan first, and then you apply it.

The plan is a JSON file:

```json
{
  "format": "gournal-migration-plan",
  "version": 1,
  "items": [
    {
      "index": 0,
      "timestamp": "2026-07-16T02:24:26.205Z",
      "messageHash": "d125ea89d8971c503f0f5909b173c9432ba5bb769e6c61c6bf560026464a3fb5",
      "summary": "Fix flaky auth test (token refresh race)"
    }
  ]
}
```

1. `index`, `timestamp`, and `messageHash` find the original line in `entries.json`. The `index` is the position of the line, starting at 0. The `messageHash` is the SHA-256 hash of the original message, in hex. If one of them does not match, gournal writes nothing.
2. `summary` is required. It must be one line of at most 120 characters.
3. `details`, `kind`, `tags`, and `project` are optional. A missing field stays as it is.
4. The plan must not lose text. The summary plus the details must contain the original message.
5. If you give a new `summary` and no `details`, gournal puts the original message in `details`.
6. Set `details` to `null` only when the summary holds the full original message.

First, write the changes to a Markdown file. A dry run changes no entries. It can still import lines of `entries.json` that gournal has not imported yet:

```console
$ gournal migrate --plan plan.json --dry-run --diff diff.md
Dry run: 1 entries would change. Diff written to diff.md.
```

The diff shows each entry before and after:

````text
### 0 2026-07-16T02:24:26.205Z

**before**

```
summary: Fixed the flaky auth test.
details: Fixed the flaky auth test. It failed 1 in 10 runs on CI because of a race in the token refresh.
kind: done
project: new-name
tags: bug
refs:
  jira:SBDC-12
```

**after**

```
summary: Fix flaky auth test (token refresh race)
details: Fixed the flaky auth test. It failed 1 in 10 runs on CI because of a race in the token refresh.
kind: done
project: new-name
tags: bug
refs:
  jira:SBDC-12
```
````

Then apply the plan:

```console
$ gournal migrate --plan plan.json
Snapshot: /Users/you/.gournal/backups/gournal-pre-plan-20261115-163110.db
Updated 1 entries.
```

An apply also applies your current aliases and ticket prefixes to every migrated entry. Gournal saves the snapshot before it writes, and it never prunes snapshots. To undo a plan, restore the snapshot the way you restore a backup. See [Data safety and backups](/gournal/docs/guides/data-safety-and-backups/#restore-from-a-backup).

## Move to another machine

Export a bundle on the old machine, and import it on the new one. See [Data safety and backups](/gournal/docs/guides/data-safety-and-backups/#bundles). If both machines imported the same `entries.json`, gournal merges the duplicates on import. Your edited or deleted entry wins over a raw copy.

See [`gournal migrate`](/gournal/docs/reference/cli/migrate/) for the options.
