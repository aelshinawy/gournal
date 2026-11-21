---
title: Claude Code setup
description: Connect gournal to Claude Code with one command, and learn what the command changes.
---

`gournal setup claude` connects gournal to Claude Code. This page explains what the command changes, how to undo it, and how the hidden `gournal hook stop` command works. See [`gournal setup claude`](/docs/reference/setup-claude/) for the options table. See [Logging with AI agents](/docs/guides/logging-with-ai-agents/) for how agents use the result.

## What the command changes

The command has three steps and a check. It shows each change before it applies the change.

1. **MCP server and launcher.** It registers `~/.gournal/bin/gournal mcp` with `claude mcp add --scope user`. On Windows, it registers the full path of `cmd.exe`, then `/d /c`, then the full path of `gournal.cmd`, then `mcp`. The launcher and a copy of gournal go into the gournal home, `~/.gournal` by default (`%USERPROFILE%\.gournal` on Windows). See [How Claude Code starts gournal](#how-claude-code-starts-gournal).
2. **Skill.** It writes `~/.claude/skills/gournal/SKILL.md`. The skill tells Claude when to log work.
3. **Stop hook.** It adds a hook to `~/.claude/settings.json`. This step is off by default.

After the three steps, the command runs a check. The check asks nothing and changes nothing. It runs the launcher with a short `PATH`, as Claude Code does. It prints `Check: Claude Code can start gournal without your shell PATH.` when gournal starts.

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
MCP server: register gournal for all projects (claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp).
Launcher: installed in /Users/you/.gournal/runtime.
MCP server: the claude CLI was not found on PATH. Run this command yourself:
  claude mcp add --scope user gournal -- /Users/you/.gournal/bin/gournal mcp
Skill: write /Users/you/.claude/skills/gournal/SKILL.md.
Skill: installed.
Stop hook: add "/Users/you/.gournal/bin/gournal hook stop" to /Users/you/.claude/settings.json.
Stop hook: added.
Check: Claude Code can start gournal without your shell PATH.
```

When the `claude` CLI is missing, gournal prints the command, and you run it yourself. Nothing is registered in that case, so setup finishes the launcher, skill, and hook steps and then exits with code 1. When `claude` is installed, gournal runs the command for you.

Run the command again at any time. A step that is already done prints `already set up`.

## Safety rules

1. A registration that gournal wrote is moved to the launcher. This covers a bare `gournal mcp`, a Node.js path with a script path, and a launcher at another path. `--yes` moves it without a question. Without `--yes`, setup asks, and the default answer is yes. A registration that gournal did not write is replaced only when you answer yes in a terminal. The default answer is no. `--yes` does not replace it.
2. If `~/.claude/skills/gournal/SKILL.md` exists and gournal did not write it, setup leaves the file alone.
3. Before the first change to `settings.json`, setup saves a copy as `settings.json.gournal-backup`. Setup keeps that first copy. It makes no backup when `settings.json` did not exist.
4. Setup keeps every other key and hook of `settings.json`.
5. If `settings.json` is not a valid JSON object, setup does not change it, prints an error, and exits with an error.

## Undo it

```bash
gournal setup claude --uninstall
```

The command removes the MCP registration, the skill file (only if gournal wrote it), the gournal hook, and the launcher with its copy of gournal (`~/.gournal/bin` and `~/.gournal/runtime`). It changes nothing else. It asks before each step unless you pass `--yes`. It does not delete your journal. The backup file `settings.json.gournal-backup` stays.

```console
$ gournal setup claude --uninstall --yes
MCP server: not set up.
Skill: remove /Users/you/.claude/skills/gournal/SKILL.md.
Skill: removed.
Stop hook: remove the gournal hook from /Users/you/.claude/settings.json.
Stop hook: removed.
Launcher: remove /Users/you/.gournal/bin/gournal and /Users/you/.gournal/runtime.
Launcher: removed.
```

## How Claude Code starts gournal

Claude Code starts a server with the `PATH` of the app that started it. A desktop app, or a shell that does not load your version manager, can have no `gournal` command and no Node.js 22.13 or newer. The launcher solves this. It does not depend on the `PATH` of the app, because it looks for Node.js itself.

1. Setup copies the installed package into `~/.gournal/runtime`, in the gournal home.
2. Setup writes the launcher `~/.gournal/bin/gournal`. On Windows, the launcher is `%USERPROFILE%\.gournal\bin\gournal.cmd`.
3. Claude Code starts the launcher. It does not start the `gournal` command on your `PATH`.
4. The launcher looks for Node.js 22.13 or newer each time it runs. On macOS and Linux, it uses only absolute folders of the `PATH`. On Windows, it runs `where node` and skips every result under the current folder.

The launcher tries these places in order on macOS and Linux. Each step uses the first Node.js that works. In step 4, the first folder with a Node.js that works wins, and the last name in that folder wins.

1. The Node.js that worked last. Setup records the Node.js that ran it, and the launcher updates the record when it picks another one.
2. `node` on the `PATH` of Claude Code.
3. The `aliases/default` folder of fnm, then the `bin` folder of Volta.
4. The folders of versions, in this order: nvm, fnm, Volta, asdf, mise, nodenv, n, and the Homebrew `node@NN` formulas. The launcher goes through them in this order. The first folder that holds a Node.js that works wins. Inside that folder, the last name in text sort order wins, so `v24.9.0` wins over `v24.10.0`.
5. The Homebrew `opt/node` and `bin` folders of `/opt/homebrew`, `/usr/local`, and `/home/linuxbrew/.linuxbrew`, then `/usr/bin`, then `/snap/bin`.

On Windows, the launcher uses this order:

1. The Node.js that worked last.
2. `node` from `where node`.
3. `%NVM_SYMLINK%`, then `%ProgramFiles%\nodejs`, then the default alias of fnm, then Volta, then Scoop. The first one that works wins.
4. The folders of versions: nvm-windows, fnm, Volta. The first folder that holds a Node.js that works wins. Inside that folder, the last name in text sort order wins.

These changes do not break the launcher:

- A switch of the active Node.js version.
- A project version, for example `.nvmrc`, `.node-version`, or `fnm --use-on-cd`.
- The removal of a Node.js version.
- A start from the desktop app.

After you run `npm install -g gournal` for a newer version, the next `gournal` command updates the copy in `~/.gournal/runtime`. Only a package under `node_modules` updates the copy. The `mcp` and `hook` commands never update it. Run `gournal setup claude` again when you want to check the setup.

A Homebrew install also uses the launcher. The launcher runs gournal from `/opt/homebrew/opt/gournal` with `/opt/homebrew/opt/node/bin/node`. On Intel Macs, the folder is `/usr/local`. On Linux, it is `/home/linuxbrew/.linuxbrew`. These paths follow `brew upgrade` and do not need your `PATH`. If you switch from npm to Homebrew, see [Install](/docs/start-here/install/#install-gournal).

If you set `GOURNAL_HOME` when you run setup, the gournal home is that folder, and the launcher keeps it. A `GOURNAL_HOME` that Claude Code passes at run time overrides it. Run undo with the same `GOURNAL_HOME` as the install. Undo removes the two launcher files and the `runtime` folder. It removes the `bin` folder only when the folder is empty.

If Claude Code cannot start gournal, see [Claude Code cannot start gournal](/docs/resources/troubleshooting/#claude-code-cannot-start-gournal).

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
            "command": "/Users/you/.gournal/bin/gournal hook stop"
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
