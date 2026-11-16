---
title: Data safety and backups
description: Where gournal keeps your data, how it backs up, and how to restore.
---

Gournal keeps your entries on your machine. This page explains where they live, how gournal backs them up, and how to restore them.

## Where your data lives

All data is in the gournal home folder. The default is `~/.gournal`. Set `GOURNAL_HOME` to change it.

1. `gournal.db`: the SQLite database that holds your entries and your GitHub activity. It uses write-ahead logging, so two more files, `gournal.db-wal` and `gournal.db-shm`, can exist beside it.
2. `config.json`: your settings. See [Customize with config.json](/gournal/docs/guides/configuration/).
3. `backups/`: the backups.
4. `entries.json`: the file of old versions. Gournal never writes to it. See [Migrating from 0.x](/gournal/docs/guides/migrating-from-0x/).

Removed entries stay in the database. `gournal undo` and `gournal clear` remove entries softly. `gournal undo` removes the newest entry written on this machine, including an entry that an AI agent added. `gournal restore <id>` brings one back. `gournal clear` asks for confirmation. The default answer is no.

## Daily backups

Gournal copies the database to `backups/gournal-YYYY-MM-DD.db` before the first write of each local day. It keeps the newest 7 copies.

Before `gournal import` changes a database that has entries, gournal takes the daily backup if today's copy does not exist. A migration plan saves a snapshot first. See [Migrating from 0.x](/gournal/docs/guides/migrating-from-0x/#migration-plans). Gournal never prunes snapshots.

The file `gournal-YYYY-MM-DD.db` holds the state before the first change of that day. `gournal index rebuild` also takes today's backup, if none exists yet. If a backup fails, gournal prints a warning and still does the write.

## Bundles

A bundle is a JSON file with every entry, all fields, and your GitHub activity. Use a bundle to back up or to move to another machine. A bundle does not hold `config.json` or the sync cursor. Copy `config.json` yourself. The first sync on the new machine starts `github.initialSyncDays` days back.

```console
$ gournal export --format bundle --output bundle.json
✓ Exported 3 entries to bundle.json
$ gournal import bundle.json
Imported: 0 new, 0 updated, 3 unchanged, 0 duplicates merged.
```

Add `--force` to replace an earlier bundle. A scheduled backup needs `--force`, or a dated file name such as `bundle-2026-07-31.json`.

`gournal import` adds new entries, updates changed ones, and skips unchanged ones. See [`gournal export`](/gournal/docs/reference/export/) for the formats and [`gournal import`](/gournal/docs/reference/import/).

## Restore from a backup

1. Stop every gournal process. Close the Claude Code sessions, or end the `gournal mcp` processes.
2. Move `gournal.db`, `gournal.db-wal`, and `gournal.db-shm` aside.
3. Copy the backup that you chose from `backups/` to `gournal.db`.

## Restore from a bundle

1. Stop every gournal process first.
2. Run `gournal import <file>`.

## A database that is not valid

If `gournal.db` is damaged, gournal does not change it. It prints the path of the latest backup and the restore steps. Restore from that backup.

## Search index

Gournal keeps a full-text search index in the database. To drop and recreate the index, run [`gournal index rebuild`](/gournal/docs/reference/index-rebuild/). Run it only when every gournal process uses a Node build with FTS5. On a Node build without FTS5, the command refuses.
