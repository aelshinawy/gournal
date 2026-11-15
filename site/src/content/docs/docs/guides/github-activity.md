---
title: GitHub activity
description: Sync your pull requests, commits, and reviews, and link them to your entries.
---

Gournal can read what you did on GitHub. It shows that activity next to your entries in reports. This guide covers the first sync, auto-sync, owners, the link rules, and what to do when a sync warns.

Gournal uses the `gh` CLI for all GitHub calls. Gournal stores no token.

## Before you start

1. Install `gh`. See [cli.github.com](https://cli.github.com).
2. Sign in with `gh auth login`.

## The first sync

Run `gournal sync`.

```console
$ gournal sync
Synced GitHub activity since Oct 16: 4 new, 0 updated, 2 links.
```

The first sync covers the last 30 days. The setting `github.initialSyncDays` changes this number. Your numbers will differ from the example.

Later syncs start at the last sync time. To fetch older activity, pass a date. A date means the local day. An ISO timestamp is also allowed.

```bash
gournal sync --since 2026-06-01
```

Read these rules about the start point:

1. A sync that finishes moves the start point to the time of the sync.
2. A sync that stops early moves the start point to the last pull request that it finished. It never moves the start point back. The next sync continues from there. A small overlap repeats. The overlap makes no duplicates.
3. A `--since` date later than the start point leaves the start point as it is. This way, no gap stays unfetched.

Only one sync runs at a time. If another sync runs, `gournal sync` stops and asks you to try again in a minute.

See [`gournal sync`](/gournal/docs/reference/sync/) for the options.

## What gournal reads

Gournal stores four kinds of activity:

1. Pull requests that you opened.
2. Merge events of the pull requests that you opened. This includes a pull request that someone else merged. Gournal records no merge for a pull request of another person that you merged.
3. Commits that you authored in your own pull requests.
4. Reviews that you gave on pull requests of other people.

Gournal skips your reviews of your own pull requests. It skips pending reviews. It reads the commits of a pull request only when you opened the pull request.

## Limits

Each search reads at most 1000 pull requests. The limit applies to the search for your own pull requests and to the search for pull requests that you reviewed. Gournal reads at most 300 commits for each of your own pull requests. For each pull request that you reviewed, it reads the first 100 reviews, by any reviewer. Gournal prints no warning when a limit cuts the result. To stay under the limits, use a narrower `--since` date.

## Owners

Limit the sync to some owners (users or organizations) with `github.owners.include` and `github.owners.exclude` in `config.json`.

```json
{
  "github": {
    "owners": {
      "include": ["acme"],
      "exclude": ["acme-sandbox"]
    }
  }
}
```

1. When `include` has names, gournal keeps only those owners.
2. Gournal always drops the owners in `exclude`.
3. Owner names are not case sensitive.

See [Configuration keys](/gournal/docs/reference/configuration/).

## Auto-sync

You do not need to run `gournal sync` by hand. These commands sync first, and then they report:

- `gournal standup` and `gournal log`.
- The MCP tools `get_standup` and `get_work_log`.

Auto-sync follows these rules:

1. It runs at most once every `github.autoSyncMinutes` minutes. The default is 15. The time counts from the last attempt.
2. It has a budget of 10 seconds. Each call to `gh` also stops after 10 seconds.
3. If it stops early, gournal keeps what it fetched. The next sync continues where it stopped.
4. A failed sync never blocks the command. Gournal prints one warning line and uses the stored data.
5. If `gh` is not installed, auto-sync stays silent. Run `gournal sync` to see the reason.
6. If another sync runs, auto-sync does nothing.

The warning goes to stderr. For an MCP tool, the warning is the last line of the text result. It is also in the `syncWarning` field. See [Troubleshooting](/gournal/docs/resources/troubleshooting/#auto-sync-warnings) for each warning.

`gournal add` and the `add_entry` tool never use the network.

Turn auto-sync off with `github.autoSync` set to `false`, or with `GOURNAL_NO_AUTOSYNC=1`. See [Environment variables](/gournal/docs/reference/environment/).

## How activity links to entries

A link connects an entry to one piece of activity. You do not create links. Gournal derives them. It recomputes links when you add or edit an entry, and after each sync.

A link follows one of three rules. If more than one rule links the same pair, the first rule in this list wins.

### 1. PR reference

The entry has a `pr` ref, for example the tag `pr-42` or a `refs` item of type `pr`. Gournal links the entry to all activity of that pull request. Gournal finds the repository in this order:

1. The repository of the ref.
2. The repository of the entry.
3. If both are missing, gournal looks at activity of that PR number in the week of the entry. It links only when that activity is in exactly one repository.

### 2. Commit reference

The entry has a `commit` ref of 7 or more hex characters. Gournal compares the ref with the start of each commit hash. The ref must match exactly one commit. If the ref or the entry has a repository, the commit must be in that repository.

### 3. Branch and time

A `done` entry has the same repository and the same branch as an activity. The entry is within 2 hours of the activity, before or after. Exactly one `done` entry must fit. If two entries fit, gournal links neither.

Repository names are not case sensitive. Branch names are. A review has no branch, so this rule never links a review.

## How reports show activity

Linked activity shows under its entry in `gournal standup` and `gournal log`. A pull request gets one line with its most advanced event: merged, opened, or reviewed. The commits of the entry get one line with a count.

See [Standups and work logs](/gournal/docs/guides/standups-and-work-logs/#the-standup) for a full example.

The `Also` line counts the activity in the period that is not linked to a done entry in the report. Activity that links only to a blocker, a next item, or an entry that the filters hide stays in `Also`. See [Standups and work logs](/gournal/docs/guides/standups-and-work-logs/#also-and---activity) for more.

## When something goes wrong

Sync warnings and unlinked entries have their own page. See [Troubleshooting](/gournal/docs/resources/troubleshooting/).
