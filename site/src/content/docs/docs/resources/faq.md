---
title: FAQ and troubleshooting
description: Answers to common questions and fixes for common messages.
---

This page answers common questions. Each answer links to the guide that has the details.

## Where does gournal keep my data?

In the gournal home folder. The default is `~/.gournal`. Set `GOURNAL_HOME` to change it. See [Data safety and backups](/gournal/docs/guides/data-safety-and-backups/).

## The standup says `No entries found`

1. The default period is today. Try `--yesterday`, `--week`, or `--month`.
2. A filter can hide everything. Remove `--project`, `--repo`, and `--tags` and run it again.
3. Check that you added entries on this machine with `gournal log --month`.

See [Standups and work logs](/gournal/docs/guides/standups-and-work-logs/).

## An entry has the project `uncategorized`

Gournal finds the project from the directory where you add the entry. A directory that is not in a git repository gives `uncategorized`. Add the entry from inside the repository. Or set the project with a [project alias](/gournal/docs/guides/configuration/#project-aliases). An agent must pass `cwd` or `project`. See [Logging with AI agents](/gournal/docs/guides/logging-with-ai-agents/#how-the-project-is-found).

## `gournal add` says the summary was long

A summary has one line and at most 120 characters. When yours is longer, gournal prints this note and moves the rest to the details:

```text
Note: summary was long, the rest went to details.
```

See [The summary rule](/gournal/docs/start-here/core-concepts/#the-summary-rule).

## I added an entry by mistake

Run `gournal undo` to remove the newest entry written on this machine. This includes an entry that an AI agent added. Run `gournal restore <id>` to bring an entry back. See [`gournal undo`](/gournal/docs/reference/remove-restore/) and [`gournal restore`](/gournal/docs/reference/remove-restore/).

## An open blocker or next item stays in my standup

That is carry-forward. An open item shows until you close it. Run `gournal resolve <id>`. Or add a `done` entry with `--resolves <id>`. After 14 days (the default of `staleAfterDays`), the item moves to the `Stale` line. See [Kinds and carry-forward](/gournal/docs/start-here/core-concepts/#kinds-and-carry-forward).

## A GitHub warning shows when I run a report

Gournal syncs before `standup` and `log`. When the sync fails, gournal prints one line and uses the stored data. For example:

```text
gournal: GitHub sync skipped (gh is not signed in; run gh auth login); showing stored activity
```

Each reason has a fix. See [GitHub activity](/gournal/docs/guides/github-activity/#troubleshooting). To stop auto-sync, set `GOURNAL_NO_AUTOSYNC=1`.

## A pull request does not link to my entry

A link needs a PR ref, a commit ref, or a `done` entry on the same repository and branch within 2 hours of the activity. See [How activity links to entries](/gournal/docs/guides/github-activity/#how-activity-links-to-entries).

## `gournal setup claude` says `Not a terminal`

Setup asks questions, so it needs a terminal. Without one, run `gournal setup claude --yes`. See [Claude Code setup](/gournal/docs/guides/claude-code-setup/).

## Setup says the `claude` CLI was not found

Setup prints the command to run yourself. Install Claude Code, and then run the printed command. Or run `gournal setup claude` again. See [Claude Code setup](/gournal/docs/guides/claude-code-setup/).

## My agent does not use the new alias or setting

The MCP server reads `config.json` once for each process. Restart your MCP clients. See [Configuration](/gournal/docs/guides/configuration/#when-changes-apply).

## Gournal refuses to start and names `config.json`

The file is not valid. Gournal does not change it. Fix the file or delete it. The most common cause is an alias chain: `a` maps to `b`, and `b` is also a key. See [Configuration](/gournal/docs/guides/configuration/#alias-chains).

## Gournal says the database is not valid

Gournal does not change a damaged database. It prints the latest backup. Restore it with the steps in [Data safety and backups](/gournal/docs/guides/data-safety-and-backups/#restore-from-a-backup).

## `gournal index rebuild` says `This Node build has no FTS5`

Your Node build lacks the full-text search feature, so the command cannot rebuild the index. Use a Node build with FTS5. See [`gournal index rebuild`](/gournal/docs/reference/index-rebuild/).

## Does gournal send my data anywhere?

Gournal stores your journal on your machine. It calls GitHub only through the `gh` CLI, during a sync. It stores no GitHub token. Reports sync with GitHub by default. Turn this off with `github.autoSync: false` or `GOURNAL_NO_AUTOSYNC=1`. `gournal add` and the `add_entry` tool never use the network. See [GitHub activity](/gournal/docs/guides/github-activity/).
