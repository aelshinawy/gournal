---
title: Standups and work logs
description: Read your journal as a standup or a work log, filter it, and export it.
---

Gournal has two reports. `gournal standup` groups your work by project and carries open items forward. `gournal log` lists every entry in time order, grouped by day. This guide explains both, the filters, and export.

## Choose a period

Both reports take the same period options. The default is today.

| Option | Period |
|--------|--------|
| (none) | Today. |
| `-y, --yesterday` | The start of yesterday up to now. |
| `-w, --week` | The start of this week up to now. |
| `-m, --month` | The first day of this month up to now. |
| `--from <date>`, `--to <date>` | Any range. |

The week starts on Monday. Set `weekStartsOn` in `config.json` to change this. See [Customize with config.json](/gournal/docs/guides/configuration/).

A date such as `2026-07-15` means the whole local day. An ISO timestamp is also allowed. `--from` and `--to` override `--yesterday`, `--week`, and `--month`. With only `--from`, the range ends now. With only `--to`, the range starts at the start of that day.

```bash
gournal standup --week
gournal standup --from 2026-07-01 --to 2026-07-15
```

See [`gournal standup`](/gournal/docs/reference/standup/) and [`gournal log`](/gournal/docs/reference/work-log/) for every option.

## The standup

The standup has up to five parts. Gournal leaves out a part that has no content.

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

1. **Done.** Entries of kind `done` in the period, grouped by project. A line under an entry shows its linked GitHub activity. The `Done` heading shows only when another part follows. A standup with only done entries has no `Done` heading.
2. **Blockers.** Open `blocker` entries that you created up to the end of the period. They show even when you created them on an earlier day. A resolved blocker does not show.
3. **Next.** Open `next` entries, with the same rules. This is carry-forward: an open item stays in the standup until you resolve it.
4. **Stale.** One line that counts the open items older than `staleAfterDays` (14 by default). Stale items leave Blockers and Next, and the line lists their ids.
5. **Also.** GitHub activity that is not linked to a done entry in the report. See the next section.

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  16:31  Ship the invoice export

  Stale: 1 open item older than 14 days (ids: ABCDEFGH)
```

Close a stale item with `gournal resolve <id>`. Or add a `done` entry with `--resolves <id>`. See [Kinds and carry-forward](/gournal/docs/start-here/core-concepts/#kinds-and-carry-forward).

A standup with no content prints `No entries found`.

With a period longer than a day, the times in Done show the day too, for example `Sun 15 - 16:33`.

## Also and `--activity`

The `Also` line counts GitHub activity in the period that gournal did not fold under a done entry of the report. It names the counts by type. Merged and reviewed pull requests get one line each below it.

```console
$ gournal standup --activity
...
  Also happened
  acme/billing-api
    11:33  opened    #43  Add tax rounding test
  acme/web-app
    15:33  reviewed  #7   Date picker focus styles
```

With `--activity`, gournal lists every item. Items are grouped by repository, in time order. Reviews count by distinct pull request.

Some filters change this part:

1. With `--tags`, the standup has no `Also` part. Activity has no tags.
2. `--project` and `--repo` apply to activity. Gournal matches the repository of an activity to a project through your project aliases.
3. `gournal log` has no `Also` part. It shows linked activity under each entry.

See [GitHub activity](/gournal/docs/guides/github-activity/) for how activity gets linked.

## Filter a report

Three filters narrow `standup` and `log`:

- `-p, --project <project>`: entries of one project.
- `--repo <owner/name>`: entries of one repository.
- `-t, --tags <tags>`: entries that have all of these tags. Separate tags with commas.

```bash
gournal standup --week --project billing-api
gournal standup --repo acme/billing-api
gournal log --month --tags bugfix,invoices
```

A filter also narrows the open items. A filter that matches nothing prints `No entries found`.

## The work log

The work log lists every entry of the period in time order, grouped by day. It shows blockers and next items too. It does not carry items forward. It has the short id and the tags of each entry.

```console
$ gournal log

Work Log: Today (2026-11-15)

  Sun Nov 15
    16:33 MP59MAEN  Fix invoice rounding  [billing-api] #bugfix
                    ↳ opened #42 Fix rounding error in invoice totals
                    ↳ 1 commit
    16:33 FZBD2DQC  Webhook retry fails  [billing-api] #webhooks
    16:33 B0KG16WC  Add rounding test  [billing-api] #testing

  3 entries across 1 project.
```

Use the standup for a report to your team. Use the log to see what happened and when. To find old entries by words, use [`gournal find`](/gournal/docs/reference/search/).

## Export

`gournal export` writes entries as a report you can share. See [`gournal export`](/gournal/docs/reference/export/) for the formats and options. The output goes to the terminal. Add `-o <file>` to write a file.

```console
$ gournal export -t bugfix
# Gournal Export

## billing-api

- `2026-11-15 16:33` Fix invoice rounding (#bugfix)
```

```bash
gournal export --from 2026-07-01 --to 2026-07-31 -o july.md
gournal export -f csv -p billing-api -o entries.csv
```

For a full backup, use a bundle. See [Data safety and backups](/gournal/docs/guides/data-safety-and-backups/#bundles).

An agent uses the MCP tools [`get_standup`](/gournal/docs/reference/standup/), [`get_work_log`](/gournal/docs/reference/work-log/), and [`export_entries`](/gournal/docs/reference/export/) for the same reports. `export_entries` returns the newest 200 entries by default. Pass `limit` or `from` and `to` to get more.
