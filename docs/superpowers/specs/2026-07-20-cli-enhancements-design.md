# Gournal CLI enhancements

## Goal

Add a chronological work-log view plus a handful of small commands that make
the journal more useful day-to-day (undo, stats, tags/projects lookup,
consistent filters), without growing the codebase more than needed.

## Shared refactor (do first)

`src/util/entries.util.ts` (new):
- `filterByProject(entries, project?)`
- `filterByTags(entries, tags?: string[])`
- `groupByProject(entries)` (moved from `report.ts`/`export.ts`, identical logic)

`cli.ts`, `mcp.ts`, `report.ts`, `export.ts` switch to these instead of their
own inline copies. Pure refactor: no output changes, existing tests
(`report.test.ts`, `export.test.ts`, `mcp.test.ts`) must still pass unchanged.

## `gournal log`

New file `src/log.ts`, mirrors `report.ts`'s shape:

```ts
export const generateWorkLog = (entries: Entry[], options: ReportOptions & { tags?: string[] }) => string
```

Reuses `reportConfigs` from `report-configs.ts` for date range + title
(same `-y/-w/-m` semantics as `standup`). Difference from `standup`: groups
by calendar day (ascending), not by project. Each entry line shows time,
message, `[project]`, and tags — since day is now the grouping key, project
needs to stay visible per-line.

CLI: `gournal log [-y] [-w] [-m] [-p <project>] [-t <tags>]`

Footer line: `N entries across M projects.`

## `gournal undo`

Pops the last entry (array order == insertion order, since `add` always
pushes), writes back, prints what was removed. No confirmation prompt (single
entry, low risk) — unlike `clear`, which wipes everything and keeps its
prompt. If there are no entries, prints a message and exits without writing.

No separate `edit` command: `undo` + `add` covers correcting the last entry
with less surface area. Revisit only if that combo proves annoying in
practice.

## `gournal stats`

New file `src/stats.ts`:

```ts
export const generateStats = (entries: Entry[]) => string
```

Reports: total entries, per-project counts, per-tag counts, current streak
(consecutive days up to and including today or yesterday with >=1 entry).
CLI: `gournal stats [-p <project>]`.

## `gournal tags` / `gournal projects`

Distinct values with counts, sorted by frequency descending. Implemented
inline in `cli.ts` (a few lines each, no new file needed).

## Filter parity

- `find` gains `--from`/`--to` (ISO date strings), matching what
  `list_entries` already supports over MCP.
- `standup`, `log`, `export` gain `--tags`, using `filterByTags`. (`find`
  already had `--tags`.) Same convention as existing options: comma-separated
  string, e.g. `--tags bug,testing`.

Empty results (no entries in range / no entries at all) render the same
"No entries found" style message the existing commands already use, not an
error.

## MCP tools

Add to `src/mcp.ts`:
- `get_work_log`: mirrors `get_standup`'s shape (`yesterday`/`week`/`month`,
  `project`, `tags`), calls `generateWorkLog`.
- `list_tags`: distinct tags with counts, optional `project` filter.
- `list_projects`: distinct projects with counts.

`undo` and `stats` stay CLI-only — undo is destructive-ish and shouldn't be
one agent tool-call away; stats is a human-glance command, not something
agents need to query.

## Testing

Matches existing repo convention: pure functions (`entries.util.ts`,
`log.ts`, `stats.ts`) get Jest tests. CLI action callbacks in `cli.ts` stay
untested, same as today.

## Commit plan (one commit per step)

1. Refactor: extract `entries.util.ts`, wire it into existing files.
2. `gournal log` (file + CLI wiring + tests).
3. `gournal undo`.
4. `gournal stats` (file + CLI wiring + tests).
5. `gournal tags` / `gournal projects`.
6. Filter parity: `find --from/--to`, `--tags` on `standup`/`log`/`export`.
7. MCP: `get_work_log`, `list_tags`, `list_projects`.
8. README updates.

## Conventions for this work

- No Claude attribution in commit messages.
- Minimal comments; code should read as self-explanatory. Comment only where
  a decision isn't obvious from the code itself (e.g. a `ponytail:` note on a
  deliberate simplification).
