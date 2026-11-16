---
title: Claude Code setup
description: Connect gournal to Claude Code with one command, and learn what the command changes.
---

`gournal setup claude` connects gournal to Claude Code. This page explains what the command changes, how to undo it, and how the hidden `gournal hook stop` command works. See [`gournal setup claude`](/gournal/docs/reference/setup-claude/) for the options table. See [Logging with AI agents](/gournal/docs/guides/logging-with-ai-agents/) for how agents use the result.

## What the command changes

The command has three steps. It shows each change before it applies the change.

1. **MCP server.** It runs `claude mcp add --scope user gournal -- gournal mcp`. When `gournal` on your `PATH` is a different install than the one that runs now, gournal uses the full paths of Node and of the script instead.
2. **Skill.** It writes `~/.claude/skills/gournal/SKILL.md`. The skill tells Claude when to log work.
3. **Stop hook.** It adds a hook to `~/.claude/settings.json`. This step is off by default.

## Run it

Without options, the command asks before each step. In a terminal, the hook prompt defaults to no. You can also pass options:

```bash
gournal setup claude
gournal setup claude --yes
gournal setup claude --yes --hook
```

1. `--yes` applies the MCP and skill steps without asking. Without a terminal, `--yes` is required. Without it, gournal lists the changes, prints `Not a terminal. Run it again with --yes to apply these changes.`, and exits with an error.
2. `--hook` adds the Stop hook. With `--yes`, the hook step runs only when you pass `--hook`. Without `--yes`, the command asks about the hook, and `--hook` makes the answer default to yes.

This run used `--yes --hook` in a clean home folder that has no `claude` CLI:

```console
$ gournal setup claude --yes --hook
MCP server: register gournal for all projects (claude mcp add --scope user gournal -- gournal mcp).
MCP server: the claude CLI was not found on PATH. Run this command yourself:
  claude mcp add --scope user gournal -- gournal mcp
Skill: write /Users/you/.claude/skills/gournal/SKILL.md.
Skill: installed.
Stop hook: add "gournal hook stop" to /Users/you/.claude/settings.json.
Stop hook: added.
```

When the `claude` CLI is missing, gournal prints the command, and you run it yourself. Nothing is registered in that case, so setup finishes the skill and hook steps and then exits with code 1. When `claude` is installed, gournal runs the command for you.

Run the command again at any time. A step that is already done prints `already set up`.

## Safety rules

1. If gournal is already registered with a different command, setup replaces it only when you answer yes in a terminal. The default answer is no. `--yes` does not replace it.
2. If `~/.claude/skills/gournal/SKILL.md` exists and gournal did not write it, setup leaves the file alone.
3. Before the first change to `settings.json`, setup saves a copy as `settings.json.gournal-backup`. Setup keeps that first copy. It makes no backup when `settings.json` did not exist.
4. Setup keeps every other key and hook of `settings.json`.
5. If `settings.json` is not a valid JSON object, setup does not change it, prints an error, and exits with an error.

## Undo it

```bash
gournal setup claude --uninstall
```

The command removes the MCP registration, the skill file (only if gournal wrote it), and the gournal hook. It changes nothing else. It asks before each step unless you pass `--yes`. It does not delete your journal. The backup file `settings.json.gournal-backup` stays.

```console
$ gournal setup claude --uninstall --yes
MCP server: not set up.
Skill: remove /Users/you/.claude/skills/gournal/SKILL.md.
Skill: removed.
Stop hook: remove the gournal hook from /Users/you/.claude/settings.json.
Stop hook: removed.
```

## The Stop hook command

`gournal hook stop` is a hidden command. It does not show in `gournal --help` and it has no reference page. Claude Code runs it. You do not run it yourself.

Setup adds this entry to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "gournal hook stop"
          }
        ]
      }
    ]
  }
}
```

Claude Code runs the command when a session finishes a turn. It sends a JSON object on stdin. The object has the session id and the path of the session transcript. The command then follows these rules:

1. If the object says that a Stop hook is already active, it does nothing. This stops a loop.
2. If gournal already asked in this session, it does nothing.
3. It reads the transcript. It looks for an edit tool call (`Edit`, `Write`, `MultiEdit`, or `NotebookEdit`). It also looks for a log call: the `add_entry` tool of the gournal MCP server, or a `Bash` call that runs `gournal add`.
4. If the session edited files and did not log, it prints one line of JSON. Claude Code reads the line and asks Claude to log the work. Gournal remembers the session id, so it asks only once for each session.
5. In every other case, it prints nothing.

The line that it prints:

```json
{"decision":"block","reason":"Gournal: this session edited files but logged no work. Call add_entry once with a summary of the work (pass project and cwd). Then stop."}
```

The command never opens the journal database. It keeps the session ids in `hook-state.json` in the gournal home folder. It removes ids older than 7 days when it adds a new id. Any error gives no output and exit code 0, so the hook never breaks a session.

To turn the hook off, run `gournal setup claude --uninstall`, or remove the entry from `settings.json`.
