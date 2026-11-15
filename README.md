# 📔 Gournal

**A Developer's Command-Line Journal with Git Integration**

[![CI](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml/badge.svg)](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/gournal)](https://www.npmjs.com/package/gournal)
[![npm downloads](https://img.shields.io/npm/dm/gournal)](https://www.npmjs.com/package/gournal)
[![License: MIT](https://img.shields.io/npm/l/gournal)](https://opensource.org/licenses/MIT)

Gournal is a CLI tool that helps developers:
- Log daily work in context of Git projects
- Generate standup reports automatically

![gournal demo](./demo.gif)

## ✨ Features

- **Git-Aware Logging**: Auto-tag entries with project names
- **Standup Reports**: `gournal standup` generates daily, weekly, or monthly summaries
- **Work Log**: `gournal log` shows a chronological, by-day view (daily/weekly/monthly), unlike `standup`'s per-project grouping
- **Stats**: `gournal stats` shows entry counts by project/tag and your current daily streak
- **Undo**: `gournal undo` removes the most recently added entry
- **Lookup**: `gournal tags` / `gournal projects` list distinct values with counts
- **Project Filtering**: Scope standup/export/find output to a single project with `--project`
- **Export**: `gournal export` writes entries to Markdown, CSV, or a full bundle
- **Kinds**: mark an entry as `done`, `blocker`, or `next`, and close open items with `resolve`
- **SQLite storage**: entries live in one database with automatic daily backups
- **MCP Server**: `gournal mcp` exposes your journal to AI agents like Claude Code

## 🚀 Quick Start

### Prerequisites
- Node.js 22.13+
- Git 2.31 or newer (for project detection)

### Installation
```bash
npm install -g gournal
# or
yarn global add gournal
```

### Usage
```bash
# Log an entry
gournal add "Fixed the flaky auth test" --tags bug,testing

# Daily / weekly / monthly standup
gournal standup
gournal standup --week
gournal standup --month

# Scope any report to one project or repository
gournal standup --week --project gournal
gournal standup --repo acme/collection-app

# Any date range (a date means the whole local day)
gournal standup --from 2026-07-01 --to 2026-07-15

# Chronological work log
gournal log --week
gournal log --month --tags bug,testing

# Longer text, entry kind, and resolving open items
gournal add "Auth test still flaky" --details "Fails 1 in 10 on CI" --kind blocker
gournal add "Fixed the flaky auth test" --resolves 1A2B3C4D

# Undo the last entry, restore a removed one, close an open one
gournal undo
gournal restore 1A2B3C4D
gournal resolve 1A2B3C4D

# Stats and lookups
gournal stats
gournal tags
gournal projects

# Find entries in a date range
gournal find "auth" --from 2026-07-01 --to 2026-07-15

# Find open blockers and next items
gournal find "auth" --kind blocker,next --status open --limit 10

# Export entries
gournal export --format md
gournal export --format csv --project gournal --output entries.csv

# Full bundle: all fields, for backup or moving to another machine
gournal export --format bundle --output bundle.json
gournal import bundle.json
```

### Standup sections
`gournal standup` shows these sections:
- **Done**: entries of kind `done` in the period, grouped by project. The heading shows only when another section follows.
- **Blockers**: open `blocker` entries created up to the end of the period, even from earlier days. A resolved blocker does not show.
- **Next**: open `next` entries, with the same rules.
- **Stale**: one line that counts open items older than `staleAfterDays`. Stale items leave Blockers and Next.

### `standup` and `log` options
- `-y, --yesterday`, `-w, --week`, `-m, --month`: choose the period. The default is today.
- `--from <date>`, `--to <date>`: choose any range. A date such as `2026-07-15` means the whole local day. An ISO timestamp is also allowed. These override the period flags.
- `-p, --project <project>`, `--repo <owner/name>`, `-t, --tags <tags>`: filter the entries.

### `find` options
- `-p, --project <project>`, `-t, --tags <tags>`, `--repo <owner/name>`: filter the entries.
- `--from <date>`, `--to <date>`: date range (inclusive).
- `-k, --kind <kinds>`: comma-separated kinds. Each one is `done`, `blocker`, or `next`.
- `--status <status>`: `open` or `resolved`.
- `-n, --limit <n>`: show at most `n` entries. It must be a positive integer.

The search text matches the summary and the details. Every word must match.

### `export` options
- `-f, --format <format>`: `md` (default), `csv`, or `bundle`.
- `-p, --project <project>`, `-t, --tags <tags>`, `--from <date>`, `--to <date>`: narrow `md` and `csv` output. A bundle always holds every entry.
- `-o, --output <file>`: write to a file instead of stdout.

### `add` options
- `-t, --tags <tags>`: comma-separated tags.
- `-d, --details <text>`: longer text for the entry. The summary must be one line of at most 120 characters. The CLI moves the rest of a longer summary to details.
- `-k, --kind <kind>`: `done` (default), `blocker`, or `next`.
- `--resolves <ids>`: comma-separated ids of open `blocker` or `next` entries that this entry closes. An id is the full id or the last 8 characters.

### Other commands
- `gournal restore <id>`: restore a removed entry (`undo` and `clear` remove entries softly).
- `gournal resolve <id>`: mark an open `blocker` or `next` entry as resolved.
- `gournal export --format bundle [-o <file>]`: write every entry with all fields as JSON.
- `gournal import <file>`: import a bundle. It adds new entries, updates changed ones, and skips unchanged ones. It merges duplicates of migrated entries and soft deletes the older copy.
- `gournal index rebuild`: drop and recreate the full-text search index. Run it only when every gournal process uses a Node build with FTS5. It refuses on a Node build without FTS5.
- `gournal migrate`: import `entries.json` into the database. Entries that are already present are skipped.
- `gournal migrate --plan <file> [--dry-run --diff <file>]`: apply a reviewed migration plan. See "Migration plans".

### Configuration
Gournal keeps its settings in `~/.gournal/config.json`. It creates the file on first run. All keys are optional.

- `deviceId`: a stable id for this machine. Gournal generates it. Do not change it.
- `projectAliases`: map an old project name to the name to use, for example `{ "old-name": "new-name" }`.
- `tagAliases`: map an old tag to the tag to use, for example `{ "bugfix": "bug" }`.
- `ticketPrefixes`: list of ticket prefixes, for example `["SBDC", "PLAT"]`. A tag that looks like a ticket (for example `sbdc-12`) becomes a Jira ref only when its prefix is in this list. A `pr-N` tag always becomes a PR ref.

- `weekStartsOn`: the first day of the week, a number from 0 (Sunday) to 6. The default is 1 (Monday). `--week` uses it.
- `staleAfterDays`: the age in days after which an open blocker or next item counts as stale. The default is 14.

- `github.*`: reserved for the next phase. Gournal reads these settings and does not use them yet.
  - `github.autoSync`: true or false. The default is true.
  - `github.autoSyncMinutes`: a positive whole number. The default is 15.
  - `github.initialSyncDays`: a positive whole number. The default is 30.
  - `github.owners.include` and `github.owners.exclude`: lists of owner names. Both default to an empty list.

An invalid `weekStartsOn`, `staleAfterDays`, or `github.*` value falls back to its default and prints one warning.

Alias chains are rejected. If `a` maps to `b`, then `b` must not be a key in the same map. Gournal refuses to start and names the file when the config is not valid. It does not change the file.

### Environment
- `GOURNAL_HOME`: the folder for all gournal data. The default is `~/.gournal`.

### Migration plans
A migration plan rewrites entries that came from `entries.json`. You review the plan before you apply it. Use `--dry-run --diff <file>` to write the changes to a markdown file and change nothing.

```bash
gournal migrate --plan plan.json --dry-run --diff plan-diff.md
gournal migrate --plan plan.json
```

The plan file is JSON:
```json
{
  "format": "gournal-migration-plan",
  "version": 1,
  "items": [
    {
      "index": 0,
      "timestamp": "2026-07-16T02:24:26.205Z",
      "messageHash": "<sha256 of the original message>",
      "summary": "New one-line summary",
      "details": "Optional longer text",
      "kind": "done",
      "tags": ["optional", "tags"],
      "project": "optional-project"
    }
  ]
}
```
- `index`, `timestamp`, and `messageHash` find the original item in `entries.json`. If one does not match, gournal writes nothing.
- `summary` is required. It must be one line of at most 120 characters.
- `details`, `kind`, `tags`, and `project` are optional. A missing field stays as it is.
- The plan must not lose text. The summary plus the details must contain the original message.
- If you give a new `summary` and no `details`, gournal puts the original message in `details`.
- If you give `details` that lose the original message, gournal rejects the plan.
- Set `details` to `null` only when the summary holds the full original message.

### Data safety
- Entries live in the SQLite database `~/.gournal/gournal.db`.
- Gournal makes a daily backup in `~/.gournal/backups/` as `gournal-YYYY-MM-DD.db`. It keeps the newest 7.
- To restore a backup:
  1. Stop every gournal process. Close the Claude Code sessions, or kill the `gournal mcp` processes.
  2. Move `gournal.db`, `gournal.db-wal`, and `gournal.db-shm` aside.
  3. Copy the chosen `backups/gournal-YYYY-MM-DD.db` to `gournal.db`.
- To restore from a bundle:
  1. Stop every gournal process first. Close the Claude Code sessions, or kill the `gournal mcp` processes.
  2. Run `gournal import <file>`.
  Gournal merges duplicates of migrated entries automatically. Your edited or deleted entry wins over a raw copy that gournal imported from `entries.json`.
- `gournal migrate --plan` first saves a snapshot as `backups/gournal-pre-plan-<yyyyMMdd-HHmmss>.db`. Gournal never prunes snapshots. You can restore a snapshot the same way as a daily backup.
- `entries.json` from older versions is read-only. Gournal never writes to it. Gournal imports it into the database automatically, and `gournal migrate` imports it on request.
- After an upgrade from 0.6.x or older, restart your MCP clients. Old servers keep running and write to `entries.json`, not to the database. Run `gournal migrate` to import those late entries.
- Removed entries stay in the database. `restore` brings them back.
- `clear` asks for confirmation. The default answer is no.

## 🤖 MCP Server

`gournal mcp` starts an [MCP](https://modelcontextprotocol.io) server (stdio transport) that exposes your journal to AI agents like Claude Code. It reuses the same storage/report/export logic as the CLI, so agents see exactly what you'd see.

Tools exposed:
- `add_entry` — add an entry with `summary` (one line, max 120 characters), `details`, `kind`, `project`, `tags`, `refs`, and `resolves`
- `update_entry` — change fields of an entry by id (full id or last 8 characters)
- `delete_entry` — soft delete an entry (`gournal restore` brings it back)
- `resolve_entry` — mark an open blocker or next entry as resolved
- `list_entries` — list entries newest-first, filterable by `project`, `from`, `to`, capped by `limit` (default 50, max 500)
- `find_entries` — search entries. Every filter is optional: `project`, `repo`, `tags`, `text` (every word must match), `kind`, `status`, `source`, `from`, `to`, `order`, and `limit` (default 50, max 500)
- `get_standup` — generate a standup report (`yesterday` / `week` / `month`, filterable by `project`)
- `export_entries` — export entries to `md` or `csv`
- `get_work_log` — generate a chronological work log grouped by day (`yesterday` / `week` / `month`, filterable by `project`/`tags`)
- `list_tags` — distinct tags with counts, filterable by `project`
- `list_projects` — distinct projects with counts

Every data tool also returns structured content that matches its `outputSchema`. The write tools return `{ entry, notes }`. `list_entries`, `list_tags`, and `list_projects` keep their JSON text. The report tools and `find_entries` return Markdown text. No MCP output contains ANSI codes. `export_entries` returns a document and has no `outputSchema`. When more entries exist than its `limit`, it adds a second text block with a notice.

### Project identity

`add_entry` accepts a `cwd` parameter. Pass your working directory so that gournal can record the project, repo, and branch. Gournal fills each field in this order:

1. The explicit `project`, `repo`, and `branch` arguments. Each field wins on its own.
2. The `cwd` argument.
3. The first root that the MCP client reports.
4. The working directory of the server process. Gournal uses it only when the call has no `project`.
5. The project `uncategorized`.

A directory that is not in a git repository resolves to `uncategorized`. Project identity needs Git 2.31 or newer.

### Using with Claude Code

Register it as an MCP server, e.g. with the Claude Code CLI:
```bash
claude mcp add gournal -- gournal mcp
```

Or add it directly to your MCP client config (e.g. `.mcp.json`):
```json
{
  "mcpServers": {
    "gournal": {
      "command": "gournal",
      "args": ["mcp"]
    }
  }
}
```

Once registered, you can ask your agent things like "summarize what I worked on this week" or "export my gournal entries for the api project to markdown."