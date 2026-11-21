---
title: Troubleshooting
description: Fix GitHub sync warnings, Claude Code start errors, and entries that do not link to activity.
---

This page explains the messages that gournal prints when a GitHub sync has a problem. It also explains why an entry may not link to a pull request. For a Claude Code start error, see [Claude Code cannot start gournal](#claude-code-cannot-start-gournal). For other questions, see the [FAQ](/docs/resources/faq/).

## A warning shows when I run a report

Gournal syncs before `standup` and `log`. When the sync fails, gournal prints one line and uses the stored data. A sync warning has one line. `REASON` in the lines below stands for the cause. Find the cause in [The reasons](#the-reasons).

### Auto-sync warnings

Auto-sync prints one of two lines:

```text
gournal: GitHub sync skipped (REASON); showing stored activity
gournal: GitHub sync stopped early (REASON); run gournal sync to catch up
```

The first line means that the sync fetched nothing. The second line means that the sync fetched some pull requests and stopped. In both cases the report still shows the stored data.

To stop auto-sync, set `github.autoSync` to `false` or set `GOURNAL_NO_AUTOSYNC=1`. See [Auto-sync](/docs/guides/github-activity/#auto-sync).

### Manual sync messages

`gournal sync` stops with this line when it fails:

```text
GitHub sync failed (REASON)
```

When it stops early, it prints the summary line and this text:

```text
Stopped early (REASON); run gournal sync again to continue.
```

If another sync runs, `gournal sync` stops with this message. Wait a minute and run it again.

```text
Another GitHub sync is running; try again in a minute.
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

## A pull request does not link to my entry

A link needs a PR ref, a commit ref, or a `done` entry on the same repository and branch within 2 hours of the activity. See [How activity links to entries](/docs/guides/github-activity/#how-activity-links-to-entries). Then check these points:

1. Check that the entry is `done` for the branch rule. A `blocker` or `next` entry links only by a PR ref or a commit ref.
2. Check that the entry has the repository and the branch. Add the entry from inside the repository.
3. Check the 2 hour window. The entry and the activity must be within 2 hours.
4. Check that no other `done` entry is within 2 hours of the same activity.
5. Add a PR ref. Use the tag `pr-42` or run `gournal add "..." -t pr-42`. The ref links the entry to all activity of the pull request.

If gournal prints `gournal: relink after write failed (...)` on stderr, the entry was saved, but gournal could not update its links. The next edit of the entry recomputes them.

## Claude Code cannot start gournal

Claude Code starts gournal through a launcher. See [How Claude Code starts gournal](/docs/guides/claude-code-setup/#how-claude-code-starts-gournal). When the launcher or Node.js fails, gournal prints one line. In the table, `VERSION` is the Node.js version, `NODE_PATH` is the path of the Node.js program, `GOURNAL_HOME` is your gournal home folder (`~/.gournal` by default), `SOURCE` is the folder of the installed gournal package, and `LAUNCHER` is the launcher path (`~/.gournal/bin/gournal`).

| Message | What to do |
| --- | --- |
| `gournal needs Node.js 22.13 or newer. This is Node.js VERSION at NODE_PATH. Switch to Node.js 22.13 or newer and run the command again.` | Switch to Node.js 22.13 or newer. Then run the command again. |
| `gournal needs the node:sqlite module. The Node.js VERSION build at NODE_PATH does not have it. Install an official Node.js build.` | Install Node.js from nodejs.org or from a version manager. Some distribution builds lack `node:sqlite`. |
| `gournal: the launcher cannot find gournal in SOURCE or in GOURNAL_HOME/runtime. Run "gournal setup claude" in a terminal, or run "claude mcp remove --scope user gournal" to remove gournal from Claude Code.` | To keep gournal, install it again and run `gournal setup claude`. Setup copies gournal into the `runtime` folder again. To remove gournal, run the `claude mcp remove` command from the message. |
| `gournal: the installed package SOURCE is missing. gournal runs from its copy in GOURNAL_HOME/runtime.` | The installed package is gone. For one minute after gournal first notices the removal, the MCP server runs from its copy. Install gournal again, or run `LAUNCHER setup claude --uninstall`. |
| `gournal: gournal is no longer installed: SOURCE is gone. To remove gournal from Claude Code, run: LAUNCHER setup claude --uninstall` | The package was removed, and the one minute after gournal first noticed it is over. The MCP server stops. Run the command from the message to remove gournal from Claude Code. |
| `gournal: found no Node.js 22.13 or newer with the node:sqlite module. Install Node.js 22.13 or newer. Then run "gournal setup claude" in a terminal.` | Install Node.js 22.13 or newer. Then run `gournal setup claude`. |
| `Check: the launcher did not start gournal (exit N).` | Read the text after the message. It holds the first line that the launcher printed. Fix that error, and run `gournal setup claude` again. |

The Stop hook prints none of these messages. It exits with code 0 and no output.

### You removed gournal before you ran the uninstall

If you removed gournal before you ran `gournal setup claude --uninstall`, run `~/.gournal/bin/gournal setup claude --uninstall`. On Windows, run `%USERPROFILE%\.gournal\bin\gournal.cmd setup claude --uninstall`. The Stop hook stays silent. For one minute after gournal first notices the removal, Claude Code can still use gournal from its copy. After that, the MCP server stops with a message. About one hour after gournal first notices the removal, the next Stop hook removes the gournal setup. It removes only what this gournal home wrote. It keeps your journal. A registration that another gournal home or another tool wrote stays, and so does a legacy bare `gournal mcp` registration. When the `claude` command is not found at that time (common when Claude Code starts from a desktop app), the registration and the launcher stay. Then run the command above yourself.

Two cases are not detected. If you remove gournal and then the Node.js version that held it, the copy keeps serving until you run the command above. A Volta global install has the same limit, because Volta removes the whole package folder. Removing a Node.js version alone, or switching to another one, never removes the setup.

After you fix the cause, check the registration.

1. Run `claude mcp list`. The list must show `gournal`.
2. Run `gournal setup claude` again. It replaces an old registration.
