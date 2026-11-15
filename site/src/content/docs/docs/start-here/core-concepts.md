---
title: Core concepts
description: Entries, kinds, tags and refs, projects, GitHub activity, and links.
---

This page explains the words that gournal uses. Each section links to the reference for details.

## Entries

An entry is one line in your journal. It has these fields:

- **Summary:** one line of text.
- **Details:** optional longer text.
- **Kind:** `done`, `blocker`, or `next`.
- **Project, repository, and branch:** gournal fills these from the directory where you add the entry.
- **Tags and refs:** optional labels and links to tickets, pull requests, and commits.

Gournal gives each entry a unique id. The short id is the last 8 characters. You can use the short id anywhere that a command asks for an id.

### The summary rule

A summary is one line. It has at most 120 characters. Gournal counts Unicode characters, not bytes. A summary with a line break is too long.

Put longer text in details. The CLI helps you when you break the rule. It keeps the first sentence as the summary, shortens it to 120 characters with `...` when needed, and moves the full text to details. It then prints a note.

The `add_entry` MCP tool is stricter. It rejects a long summary that has no details, and it returns an error that tells the agent to shorten the summary and use details. If the agent sends the same text again, the tool splits it.

## Kinds and carry-forward

The kind says what an entry means.

1. `done` is finished work. This is the default.
2. `blocker` is something that stops you.
3. `next` is a planned step.

A `blocker` or a `next` entry is open until you close it. Close it in one of two ways:

- Run `gournal resolve <id>`.
- Add a `done` entry with `--resolves <id>`. Gournal closes the open entry and records which entry closed it.

A `done` entry has no open or resolved state.

Done entries belong to the day they were logged. Open items do not. The standup shows an open blocker or next item from earlier days until you resolve it. This is carry-forward. A resolved item does not show.

When an open item is older than `staleAfterDays` (14 days by default), the standup moves it out of Blockers and Next. It shows one `Stale` line with a count and the ids instead. See [Configuration keys](/gournal/docs/reference/configuration/).

## Tags and refs

Tags are free labels, such as `bugfix` or `testing`. Gournal lowercases a tag. It replaces spaces with hyphens. It removes duplicates. A `tagAliases` map in `config.json` renames a tag, for example `bugfix` to `bug`.

Refs link an entry to something outside the journal. A ref has one of these types: `pr`, `jira`, `commit`, or `url`.

Some tags are really refs. Gournal turns them into refs:

- A tag like `pr-42` always becomes a pull request ref.
- A tag like `bill-12` becomes a ticket ref (`BILL-12`) only when its prefix is in `ticketPrefixes` in `config.json`.

```json
{ "ticketPrefixes": ["BILL", "PLAT"] }
```

The tools use refs for [links](#links). MCP tools take refs in a `refs` field, so agents should put ticket keys, PR numbers, and commit hashes there, not in tags. See [`add_entry`](/gournal/docs/reference/add/).

## Projects and identity

A project is the name that groups your entries in reports. Gournal finds it from the directory where you work. It runs `git` in that directory and gets the repository name from the `origin` remote.

Gournal picks the project in this order:

1. A name that you map in `projectAliases`.
2. The repository name, for example `billing-api` for `acme/billing-api`.
3. The name of the folder that holds the repository.
4. `uncategorized`, when the directory is not in a git repository, or when Git is older than 2.31 or missing. Gournal then records no repository or branch.

A git worktree maps to its main repository, so all worktrees of a repo share one project. This mapping needs a common Git directory that is named `.git`. The `origin` remote name still comes first. A worktree of a bare repository uses the name of its own folder only as the fallback.

Project aliases rename a project. They match the full repository name, then the repository name, then the folder name. Matching is not case sensitive. An alias also applies to old entries when you filter by `--project`.

```json
{ "projectAliases": { "billing-api": "billing" } }
```

Gournal reads `~/.gournal/config.json`. See [Customize with config.json](/gournal/docs/guides/configuration/).

An agent that uses the MCP server passes its working directory as `cwd`, so gournal can find the right project. See [Logging with AI agents](/gournal/docs/guides/logging-with-ai-agents/).

## Activity

Activity is what GitHub says you did. Gournal stores four types:

1. A pull request that you opened.
2. A merge event of a pull request that you opened. Whoever merged it, gournal records the event.
3. A commit that you authored in one of your pull requests.
4. A review that you gave on another person's pull request.

`gournal sync` fetches activity through the `gh` CLI. Activity is not an entry. You do not write it, and it has no tags. Gournal keeps it apart from your entries and uses it in reports.

Sync settings, such as which owners to include, live in `config.json`. See [GitHub activity](/gournal/docs/guides/github-activity/).

## Links

A link connects one entry to one piece of activity. Gournal derives links. You do not create them. Gournal recomputes them when you add or edit an entry, and after each sync.

A link follows one of three rules:

1. **PR reference.** The entry has a `pr` ref. Gournal links the entry to all activity of that pull request.
2. **Commit reference.** The entry has a `commit` ref of at least 7 hex characters. It must match exactly one commit.
3. **Branch and time.** A `done` entry has the same repository and branch as an activity, and is within 2 hours of it. Exactly one entry must fit.

Linked activity shows under its entry in `standup` and `log`. Activity that is not linked to a shown done entry shows in the standup under `Also`. The standup prints an `Also:` line with counts, and one line for each merged or reviewed pull request. Opened pull requests are counted, and they get no line. Run `gournal standup --activity` to list every item.

See [Standups and work logs](/gournal/docs/guides/standups-and-work-logs/) and [GitHub activity](/gournal/docs/guides/github-activity/).
