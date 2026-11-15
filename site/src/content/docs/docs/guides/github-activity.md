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

Only one sync runs at a time. If another sync runs, `gournal sync` stops with this message:

```text
Another GitHub sync is running; try again in a minute.
```

See [`gournal sync`](/gournal/docs/reference/cli/sync/) for the options.

## What gournal reads

Gournal stores four kinds of activity:

1. Pull requests that you opened.
2. Merge events of the pull requests that you opened. This includes a pull request that someone else merged. Gournal records no merge for a pull request of another person that you merged.
3. Commits that you authored in your own pull requests.
4. Reviews that you gave on pull requests of other people.

Gournal skips your reviews of your own pull requests. It skips pending reviews. It reads the commits of a pull request only when you opened the pull request.

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

The warning goes to stderr. For an MCP tool, the warning is the last line of the text result. It is also in the `syncWarning` field.

`gournal add` and the `add_entry` tool never use the network.

Turn auto-sync off with `github.autoSync` set to `false`. Or set the environment variable `GOURNAL_NO_AUTOSYNC=1`. See [Environment variables](/gournal/docs/reference/environment/).

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

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  16:33  Fix invoice rounding
         ↳ opened #42 Fix rounding error in invoice totals
         ↳ 1 commit

  Blockers
    Nov 15  FZBD2DQC  Webhook retry fails  [billing-api]

  Next
    Nov 15  B0KG16WC  Add rounding test  [billing-api]

  Also: 1 PR opened, 1 review in 2 repos (--activity to expand)
    reviewed  acme/web-app#7  Date picker focus styles
```

The `Also` line counts the activity in the period that is not linked to a done entry in the report. Activity that links only to a blocker, a next item, or an entry that the filters hide stays in `Also`. See [Standups and work logs](/gournal/docs/guides/standups-and-work-logs/#also-and---activity) for more.

## Troubleshooting

A sync warning has one line. `REASON` in the lines below stands for the cause.

### Auto-sync warnings

Auto-sync prints one of two lines:

```text
gournal: GitHub sync skipped (REASON); showing stored activity
gournal: GitHub sync stopped early (REASON); run gournal sync to catch up
```

The first line means that the sync fetched nothing. The second line means that the sync fetched some pull requests and stopped. In both cases the report still shows the stored data.

### Manual sync messages

`gournal sync` stops with one of these lines when it fails:

```text
GitHub sync failed (REASON)
```

When it stops early, it prints the summary line and this text:

```text
Stopped early (REASON); run gournal sync again to continue.
```

### The reasons

| Reason text | What to do |
|-------------|------------|
| `gh is not signed in; run gh auth login` | Run `gh auth login`. Then run `gournal sync`. |
| `GitHub rate limit reached` | Wait. Then run `gournal sync`. It continues where it stopped. |
| `no network` | Check your connection. Then run `gournal sync`. |
| `timed out after 10 s` | Auto-sync ran out of time. Run `gournal sync`. A manual sync waits up to 60 seconds for each call. |
| `a GitHub call timed out` | A manual sync ran out of time. Run `gournal sync` again. |
| `gh is not installed; see https://cli.github.com` | Install `gh`. Or set `GOURNAL_GH` to the path of `gh`. |
| The first line of an error from `gh` | Run the `gh` command yourself to see the full error. |

Example: auto-sync when `gh` is not signed in.

```console
$ gournal standup
gournal: GitHub sync skipped (gh is not signed in; run gh auth login); showing stored activity

Standup: Today (2026-11-15)
...
```

Example: a manual sync that stops early because of the network.

```console
$ gournal sync
Synced GitHub activity since Oct 16: 2 new, 0 updated, 0 links. Stopped early (no network); run gournal sync again to continue.
```

### Another problem: an entry has no link

1. Check that the entry is `done` for the branch rule. A `blocker` or `next` entry links only by a PR ref or a commit ref.
2. Check that the entry has the repository and the branch. Add the entry from inside the repository.
3. Check the 2 hour window. The entry and the activity must be within 2 hours.
4. Check that no other `done` entry is within 2 hours of the same activity.
5. Add a PR ref. Use the tag `pr-42` or run `gournal add "..." -t pr-42`. The ref links the entry to all activity of the pull request.

If gournal prints `gournal: relink after write failed (...)` on stderr, the entry was saved, but gournal could not update its links. The next edit of the entry recomputes them.
