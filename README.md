# Gournal

**Your work, remembered.**

A personal work journal for you and your AI agents.

[![CI](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml/badge.svg)](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/gournal)](https://www.npmjs.com/package/gournal)
[![npm downloads](https://img.shields.io/npm/dm/gournal)](https://www.npmjs.com/package/gournal)
[![License: MIT](https://img.shields.io/npm/l/gournal)](https://opensource.org/licenses/MIT)

Gournal is a local-first work journal. You log what you finish from the terminal, or your AI agent logs it through MCP. Gournal links entries to the pull requests, commits, and reviews that `gh` reports. It turns the journal into standups, work logs, and searchable history. It keeps one SQLite file on your machine. It needs no account and stores no tokens.

![gournal demo](https://raw.githubusercontent.com/aelshinawy/gournal/main/demo.gif)

## Table of Contents

- [Who it is for](#who-it-is-for)
- [Install](#install)
- [Connect your AI agent](#connect-your-ai-agent)
- [How it works](#how-it-works)
- [Use the CLI](#use-the-cli)
- [GitHub activity](#github-activity)
- [Update and uninstall](#update-and-uninstall)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Who it is for

- Developers who give standups and want their pull requests next to their notes.
- Anyone who works with an AI agent that runs local MCP servers, such as Claude Code, and wants the agent to keep the log. That includes product managers, founders, and leads.

Install and setup need a terminal and Node.js once. After that, your agent can log work and read reports through MCP.

## Install

You need Node.js 22.13 or newer and Git 2.7 or newer. With Git older than 2.7, or without Git, gournal puts entries in the `uncategorized` project and records no repository or branch.

```bash
npm install -g gournal
gournal --version
```

Gournal prints its version number. Gournal supports macOS, Linux, and Windows (x64). Keep your journal on a local disk. See [Install](https://gournal.aelshinawy.com/docs/start-here/install/) for the requirements and the limits on each system.

Stuck? If your shell says `command not found`, your global npm folder is not on your `PATH`. Run `npm config get prefix` and add its `bin` folder to your `PATH`. See [Troubleshooting](https://gournal.aelshinawy.com/docs/resources/troubleshooting/) for more.

## Connect your AI agent

Run this command to connect gournal to Claude Code.

```bash
gournal setup claude
```

The command asks before each of three steps. Then it checks that Claude Code can start gournal:

1. **MCP server.** It registers a launcher at `~/.gournal/bin/gournal` that starts `gournal mcp` for Claude Code. The launcher lives in the gournal home, `~/.gournal` by default.
2. **Skill.** It writes `~/.claude/skills/gournal/SKILL.md`. The skill tells Claude when to log work.
3. **Stop hook.** It adds a hook to `~/.claude/settings.json`. This step is off by default. Add `--hook` to turn it on.

Restart Claude Code after setup. Then run `claude mcp list`. The list must show `gournal`.

If the `claude` CLI is not on your `PATH`, gournal prints the `claude mcp add` command for you to run yourself. Pass `--yes` to skip the questions, for example in a script. To undo everything, run `gournal setup claude --uninstall`. Your journal stays.

Other MCP clients start the server with `gournal mcp`. See [Claude Code setup](https://gournal.aelshinawy.com/docs/guides/claude-code-setup/) and [Logging with AI agents](https://gournal.aelshinawy.com/docs/guides/logging-with-ai-agents/).

## How it works

Gournal has four parts. Each part does one job.

1. **The CLI** (`gournal add`, `gournal standup`, and more) is how you log work and read reports.
2. **The MCP server** (`gournal mcp`) lets an AI agent write to the same journal and read reports from it.
3. **GitHub sync** (`gournal sync`) reads your pull requests, commits, and reviews through the `gh` CLI.
4. **The standup** is the report. It shows what you finished, what blocks you, and what comes next.

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

Every entry has a one-line summary, a project, a kind, and optional tags. Gournal fills in the project, the repository, and the branch from your current directory.

## Use the CLI

Go to a git repository. Add an entry, then read your standup.

```console
$ gournal add "Fix rounding error in invoice totals" -t bugfix,invoices
✓ Entry added! (5C9ASMEJ)

$ gournal add "Add a regression test for tax rounding" -k next -t testing
✓ Entry added! (KNWP3VQV)

$ gournal standup

Standup: Today (2026-11-15)

  Done
  billing-api
  16:19  Fix rounding error in invoice totals

  Next
    Nov 15  KNWP3VQV  Add a regression test for tax rounding  [billing-api]
```

Use `--kind blocker` for something that stops you. Use `--yesterday`, `--week`, or `--month` on the standup for other periods.

| Task | Command |
|------|---------|
| [Add an entry](https://gournal.aelshinawy.com/docs/reference/add/) | `gournal add "text" -t tag1,tag2` |
| [Standup report](https://gournal.aelshinawy.com/docs/reference/standup/) | `gournal standup --week` |
| [Work log](https://gournal.aelshinawy.com/docs/reference/work-log/) | `gournal log` |
| [Search entries](https://gournal.aelshinawy.com/docs/reference/search/) | `gournal find "text"` |
| [Close an item](https://gournal.aelshinawy.com/docs/reference/resolve/) | `gournal resolve <id>` |
| [Undo the last entry](https://gournal.aelshinawy.com/docs/reference/remove-restore/) | `gournal undo` |
| [Sync GitHub activity](https://gournal.aelshinawy.com/docs/reference/sync/) | `gournal sync` |
| [Export entries](https://gournal.aelshinawy.com/docs/reference/export/) | `gournal export` |

See the [reference](https://gournal.aelshinawy.com/docs/reference/) for every command and MCP tool.

## GitHub activity

Sign in to the GitHub CLI once with `gh auth login`. Then run `gournal sync`. Gournal reads your pull requests, commits, and reviews through `gh` and links each one to the entry that matches it. `gournal standup` and `gournal log` also sync for you, at most once every 15 minutes. Gournal stores no GitHub token. See [GitHub activity](https://gournal.aelshinawy.com/docs/guides/github-activity/).

## Update and uninstall

To update, run `npm install -g gournal` again.

To uninstall, run these commands in this order:

```bash
gournal setup claude --uninstall
npm uninstall -g gournal
```

Both commands keep your journal. It lives in `~/.gournal`. See [Data safety and backups](https://gournal.aelshinawy.com/docs/guides/data-safety-and-backups/) before you delete that folder.

## Documentation

Read the guides and the full reference at [gournal.aelshinawy.com/docs](https://gournal.aelshinawy.com/docs/).

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the setup, the tests, and the commit rules. Report security problems as described in [SECURITY.md](SECURITY.md). All contributors follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT
