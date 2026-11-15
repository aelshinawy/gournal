---
title: Logging with AI agents
description: Let an AI agent log your work through the gournal MCP server, the skill, and the Stop hook.
---

An AI agent can log your work for you. It uses the gournal MCP server. This guide explains how the agent finds the right project, how it writes a summary, and how to make sure it logs.

## The three parts

1. **The MCP server.** `gournal mcp` starts a server on stdio. The server gives the agent tools such as `add_entry` and `get_standup`. See the [MCP tools reference](/gournal/docs/reference/mcp/add_entry/).
2. **The skill.** A short file that tells Claude Code when and how to log.
3. **The Stop hook (optional).** A hook that asks Claude once to log a session that edited files and logged nothing.

The agent and the CLI share one journal. An entry that an agent adds shows in `gournal standup` like any other entry. Gournal marks the source of the entry as `mcp`.

## Connect Claude Code

Run one command. It registers the MCP server and installs the skill. It can also add the Stop hook.

```bash
gournal setup claude
```

See [Claude Code setup](/gournal/docs/guides/claude-code-setup/) for what the command changes. For another MCP client, register the server yourself. Use this command in Claude Code:

```bash
claude mcp add --scope user gournal -- gournal mcp
```

Or add the server to the MCP configuration of your client, for example `.mcp.json`:

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

A directory that is not in a git repository gives the project `uncategorized`. A project alias in `config.json` renames the project. See [Core concepts](/gournal/docs/start-here/core-concepts/#projects-and-identity).

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

A summary is one line of at most 120 characters. Put longer text in `details`. See [The summary rule](/gournal/docs/start-here/core-concepts/#the-summary-rule).

The `add_entry` tool is strict. It rejects a summary that is too long and has no `details`. The error is one line:

```text
summary is 174 chars, max 120. Put one line in summary and the rest in details.
```

It rejects a summary with a line break and no `details` with a different error:

```text
summary must be one line, max 120. Put the rest in details.
```

When the call has `details`, gournal does not reject a long summary. It splits the summary. If the agent sends a rejected text again without `details`, gournal also splits it. This works for 10 minutes after the first try. The text must be the same, or it must start with the same 60 characters. When gournal splits a summary, it keeps the first sentence as the summary, shortens it to 120 characters with `...`, and saves the full text in `details`. The tool then adds this line to its answer:

```text
Summary was too long and was split; full text is in details.
```

## Kinds

An entry has a kind. The default kind is `done`.

1. `done`: finished work.
2. `blocker`: something that stops the work.
3. `next`: a planned step.

A `blocker` or `next` entry stays open until someone closes it. The agent closes it in one of two ways:

- It adds a `done` entry and passes the id of the open entry in `resolves`.
- It calls [`resolve_entry`](/gournal/docs/reference/mcp/resolve_entry/).

The id is the full id or the last 8 characters. A bad id in `resolves` never stops the entry. Gournal drops that id, adds the entry, and tells the agent about the bad id. See [Kinds and carry-forward](/gournal/docs/start-here/core-concepts/#kinds-and-carry-forward).

## Tags and refs

Ticket keys, PR numbers, and commit hashes go in `refs`. Tags are free labels. Before the agent adds a tag, it can call [`list_tags`](/gournal/docs/reference/mcp/list_tags/) to reuse a tag that exists. When a new tag is close to an existing tag, the answer of `add_entry` names the close tags.

Refs also drive [links to GitHub activity](/gournal/docs/guides/github-activity/#how-activity-links-to-entries).

## The Stop hook

An agent can forget to log. The Stop hook is a safety net. It is off by default. Turn it on with `gournal setup claude --hook`.

When a Claude Code session ends its turn, the hook reads the transcript of the session. It asks Claude to log in one case: the session edited files, and the session did not call `add_entry` or run `gournal add`. The hook asks only once for each session. The hook never opens the journal database.

See [Claude Code setup](/gournal/docs/guides/claude-code-setup/#the-stop-hook-command) for the exact behavior.

## Read your journal from an agent

The agent can also read the journal. Ask it things like "summarize what I worked on this week". It uses [`get_standup`](/gournal/docs/reference/mcp/get_standup/), [`get_work_log`](/gournal/docs/reference/mcp/get_work_log/), or [`find_entries`](/gournal/docs/reference/mcp/find_entries/). The two report tools also sync your GitHub activity first. See [GitHub activity](/gournal/docs/guides/github-activity/#auto-sync).
