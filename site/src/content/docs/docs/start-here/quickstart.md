---
title: Quickstart
description: Install gournal, connect Claude Code, log an entry, read a standup, and sync GitHub activity.
---

This page takes you from nothing to a working setup. Each step shows real output. The examples ran in a clean home folder, so the home folder shows as `/Users/you`.

## 1. Install

You need Node.js 22.13 or newer. Run this command.

```bash
npm install -g gournal
gournal --version
```

Gournal prints its version number, for example `0.9.0`. See [Install](/docs/start-here/install/) for details.

## 2. Connect Claude Code (optional)

Skip this step if you do not use Claude Code. You can add entries yourself with the CLI.

```console
$ gournal setup claude --yes
MCP server: register gournal for all projects (claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp).
Launcher: installed in /Users/you/.gournal/runtime.
MCP server: the claude CLI was not found on PATH. Run this command yourself:
  claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp
Skill: write /Users/you/.claude/skills/gournal/SKILL.md.
Skill: installed.
Stop hook: not enabled (add --hook to enable it).
Check: Claude Code can start gournal without your shell PATH.
```

This example ran on a machine with no `claude` CLI, so gournal printed the command for you to run. With `claude` installed, gournal runs it for you. Restart Claude Code after setup. Then run `claude mcp list`. The list must show `gournal`.

See [Claude Code setup](/docs/guides/claude-code-setup/) for what the command changes, the Stop hook, and how to undo it. See [How Claude Code starts gournal](/docs/guides/claude-code-setup/#how-claude-code-starts-gournal) if you use a Node.js version manager.

## 3. Add entries

Go to a git repository. Then add an entry. Gournal records the project, the repository, and the branch from the current directory.

```console
$ gournal add "Fix rounding error in invoice totals" -t bugfix,invoices
✓ Entry added! (5C9ASMEJ)
```

Add a planned step with `--kind next`. Use `--kind blocker` for something that stops you.

```console
$ gournal add "Add a regression test for tax rounding" -k next -t testing
✓ Entry added! (KNWP3VQV)
```

The id in the output is the last 8 characters of the entry id. Your ids are different. See [`gournal add`](/docs/reference/add/).

## 4. Read your standup

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  16:19  Fix rounding error in invoice totals

  Next
    Nov 15  KNWP3VQV  Add a regression test for tax rounding  [billing-api]
```

The standup lists what you finished today, grouped by project. It also lists open blockers and next items. Use `--yesterday`, `--week`, or `--month` for other periods. See [`gournal standup`](/docs/reference/standup/) and [Standups and work logs](/docs/guides/standups-and-work-logs/).

## 5. Sync GitHub activity (optional)

Sign in to `gh` first. See [Before you start](/docs/guides/github-activity/#before-you-start). Then run this command.

```console
$ gournal sync
Synced GitHub activity since Oct 16: 2 new, 0 updated, 2 links.
```

This example used one sample pull request, so your numbers are different. The first sync covers the last 30 days. Later syncs start where the last sync stopped.

If a sync fails, gournal tells you why. See [Troubleshooting](/docs/resources/troubleshooting/).

Now run the standup again. Gournal linked the pull request and its commit to the entry, because the entry and the pull request share a repository and a branch, the entry is within 2 hours of the activity, and no other done entry fits. An older pull request does not link by this rule, and it shows in the standup under `Also`. See [Links](/docs/start-here/core-concepts/#links).

```console
$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  16:19  Fix rounding error in invoice totals
         ↳ opened #42 Fix rounding error in invoice totals
         ↳ 1 commit

  Next
    Nov 15  KNWP3VQV  Add a regression test for tax rounding  [billing-api]
```

`gournal standup` and `gournal log` also sync for you, at most once every 15 minutes. See [GitHub activity](/docs/guides/github-activity/) and [`gournal sync`](/docs/reference/sync/).

## Next steps

1. Read [Core concepts](/docs/start-here/core-concepts/).
2. Let your agent log for you: [Logging with AI agents](/docs/guides/logging-with-ai-agents/).
3. Browse the [CLI reference](/docs/reference/add/).
