---
title: Logging with AI agents
description: Let an AI agent log your work through the gournal MCP server, the skill, and the Stop hook.
---

An AI agent can log your work for you. It uses the gournal MCP server. This guide explains how the agent finds the right project, how it writes a summary, and how to make sure it logs.

## The three parts

1. **The MCP server.** `gournal mcp` starts a server on stdio. The server gives the agent tools such as `add_entry` and `get_standup`. See the [MCP tools reference](/docs/reference/add/).
2. **The skill.** A short file that tells Claude Code when and how to log.
3. **The Stop hook (optional).** A hook that asks Claude once to log a session that edited files and logged nothing.

The agent and the CLI share one journal. An entry that an agent adds shows in `gournal standup` like any other entry. Gournal marks the source of the entry as `mcp`.

## Connect Claude Code

Run one command. It registers the MCP server and installs the skill. It can also add the Stop hook.

```bash
gournal setup claude
```

See [Claude Code setup](/docs/guides/claude-code-setup/) for what the command changes, the Stop hook, and how to undo it.

The server sends instructions to the client when it connects. The instructions tell the agent to log each distinct piece of finished work, to pass `project` and `cwd`, and to keep the summary to one line. The server opens the journal when the agent first uses a tool.

## The skill

`gournal setup claude` writes the skill to `~/.claude/skills/gournal/SKILL.md`. The skill gives the agent seven rules:

1. Log each distinct piece of finished work. Do not log a quick answer.
2. Always pass `project`. Pass `cwd` so that gournal records the repo and branch.
3. Write `summary` as one line of 120 characters or fewer. Put longer text in `details`.
4. Set `kind` for blockers and planned steps.
5. Close an open item with `resolves` or `resolve_entry`.
6. Put PR numbers, ticket keys, and commit hashes in `refs`, not in `tags`.
7. Call `get_standup` or `get_work_log` for "what did I work on".

The skill file has a marker line. Gournal replaces a skill file that has the marker. It leaves a skill file without the marker alone. Edit a copy under another name if you want your own rules.

## How the project is found

An agent can run in any directory. The server process has its own working directory, which is usually not the project of the agent. So the agent passes `cwd`.

Gournal fills the project, the repository, and the branch of an entry in this order. Each field uses the first source that has a value.

1. The `project`, `repo`, and `branch` arguments of the call. Each field wins on its own.
2. The `cwd` argument. It must be an absolute path. Gournal ignores a relative path.
3. The first root that the MCP client reports.
4. The working directory of the server process. Gournal uses it only when the call has no `project`.
5. The project `uncategorized`.

A directory that is not in a git repository gives the project `uncategorized`. Git older than 2.7 gives `uncategorized` too, and gournal records no repository or branch. A project alias in `config.json` renames the project. See [Core concepts](/docs/start-here/core-concepts/#projects-and-identity).

Example: this call has `project` and `cwd`. Gournal takes the repository and the branch from `cwd`.

```json
{
  "summary": "Fix rounding in invoice totals",
  "project": "billing-api",
  "cwd": "/Users/you/billing-api",
  "tags": ["bugfix"],
  "refs": [{ "type": "pr", "value": "42" }]
}
```

```text
Entry MFPKCDQS added to billing-api: Fix rounding in invoice totals
```

The server reads `config.json` once for each process. Restart your MCP clients after you edit aliases.

## The summary rule

A summary is one line of at most 120 characters. Put longer text in `details`. See [The summary rule](/docs/start-here/core-concepts/#the-summary-rule) and [`add_entry`](/docs/reference/add/) for when gournal splits a long summary.

The `add_entry` tool is strict. It rejects a summary that is too long and has no `details`. The error is one line:

```text
summary is 174 chars, max 120. Put one line in summary and the rest in details.
```

It rejects a summary with a line break and no `details` with a different error:

```text
summary must be one line, max 120. Put the rest in details.
```

When gournal splits a summary, the tool adds this line to its answer:

```text
Summary was too long and was split; full text is in details.
```

## Kinds, tags, and refs

The agent sets `kind` to `done`, `blocker`, or `next`. It closes an open item with `resolves` on a `done` entry, or with [`resolve_entry`](/docs/reference/resolve/). A bad id in `resolves` never stops the entry. Gournal drops that id, adds the entry, and tells the agent about the bad id. See [Kinds and carry-forward](/docs/start-here/core-concepts/#kinds-and-carry-forward).

Ticket keys, PR numbers, and commit hashes go in `refs`, not in tags. Before the agent adds a tag, it can call [`list_tags`](/docs/reference/tags/) to reuse a tag that exists. When a new tag is close to an existing tag, the answer of `add_entry` names the close tags. See [Tags and refs](/docs/start-here/core-concepts/#tags-and-refs).

## The Stop hook

An agent can forget to log. The Stop hook asks Claude once to log a session that edited files and logged nothing. It is off by default. Turn it on with `gournal setup claude --hook`. See [The Stop hook command](/docs/guides/claude-code-setup/#the-stop-hook-command) for the exact behavior.

## Use another MCP client

`gournal mcp` starts the MCP server on stdio. Any MCP client can start it. The package installs the `gournal` command, so the client needs no path. Add the server to the MCP configuration of your client. Most clients use the `mcpServers` shape, for example in `.mcp.json`:

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

The server writes only MCP messages to stdout. It writes notes to stderr. The server sends its instructions to the client when it connects, so the agent gets the logging rules without the skill. The skill is a Claude Code feature. For another client, copy the rules from [The skill](#the-skill) into the instructions of your agent. Restart the client after you change its configuration. See [`gournal mcp`](/docs/reference/mcp-server/).

## Read your journal from an agent

The agent can also read the journal. Ask it things like "summarize what I worked on this week". It uses [`get_standup`](/docs/reference/standup/), [`get_work_log`](/docs/reference/work-log/), or [`find_entries`](/docs/reference/search/). The two report tools also sync your GitHub activity first. See [GitHub activity](/docs/guides/github-activity/#auto-sync).
