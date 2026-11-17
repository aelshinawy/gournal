---
title: Introduction
description: A work journal for you and your AI agents. What it is, who it is for, and how the CLI, the MCP server, GitHub sync, and the standup fit together.
---

Gournal is a work journal for you and your AI agents. You log what you did. Gournal turns the log into standups and work logs.

Gournal stores everything on your machine in one SQLite database. It needs no account and no server. It stores no GitHub token.

## Who it is for

Gournal is for people who:

- give a standup update every day or every week,
- forget what they did last Tuesday,
- work with an AI agent that runs local MCP servers, such as Claude Code, and want the agent to keep the log, whether they write code or not (product managers, founders, and leads too),
- want to see their pull requests next to their notes.

Install and setup need a terminal and Node.js once. After that, your agent can log work and read reports through MCP.

## How the parts fit

Gournal has four parts. Each part does one job.

1. **The CLI** (`gournal add`, `gournal standup`, and more) is how you log work and read reports.
2. **The MCP server** (`gournal mcp`) lets an AI agent write to the same journal and read reports from it.
3. **GitHub sync** (`gournal sync`) reads your pull requests, commits, and reviews through the `gh` CLI.
4. **The standup** is the report. It shows what you finished, what blocks you, and what comes next. It also shows the GitHub activity that matches your entries.

```text
INPUTS
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│       You       │  │    AI agent     │  │   GitHub sync   │
│      (CLI)      │  │      (MCP)      │  │    (gh CLI)     │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
                     ┌─────────────────┐
                     │     gournal     │
                     └────────┬────────┘
OUTPUTS                       │
         ┌────────────────────┴────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     standup     │  │       log       │  │     export      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

You and your agent write entries. GitHub sync adds activity. Gournal links activity to the entries it matches. The standup reads all of it.

## What an entry looks like

Every entry has a one-line summary. It also has a project, a kind, and optional tags. Gournal fills in the project, the repository, and the branch from your current directory.

You write this:

```console
$ gournal add "Fix rounding error in invoice totals" -t bugfix,invoices
```

You read this later:

```console
$ gournal standup

Standup: Today (2026-11-15)

  billing-api
  16:26  Fix rounding error in invoice totals
```

## Where to go next

1. [Install gournal](/docs/start-here/install/).
2. Follow the [Quickstart](/docs/start-here/quickstart/). It takes about five minutes.
3. Read [Core concepts](/docs/start-here/core-concepts/) to learn the words that gournal uses.
