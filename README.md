# 📔 Gournal

**A Developer's Command-Line Journal with Git Integration**

[![CI](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml/badge.svg)](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/gournal)](https://www.npmjs.com/package/gournal)
[![npm downloads](https://img.shields.io/npm/dm/gournal)](https://www.npmjs.com/package/gournal)
[![License: MIT](https://img.shields.io/npm/l/gournal)](https://opensource.org/licenses/MIT)

Gournal is a command-line work journal. You log what you did, and gournal builds your standups and work logs from the entries. It stores everything in a local SQLite database. It needs no account. It links your entries to the pull requests, commits, and reviews that `gh` reports. An MCP server lets AI agents such as Claude Code log work for you.

![gournal demo](./demo.gif)

## Install

You need Node.js 22.13 or newer and Git 2.31 or newer. With Git older than 2.31, or without Git, gournal puts entries in the `uncategorized` project and records no repository or branch.

```bash
npm install -g gournal
```

## Quickstart

```bash
gournal add "Fixed the flaky auth test" --tags bug,testing
gournal add "Review the retry change" --kind next
gournal standup
gournal standup --week
gournal setup claude
```

## Documentation

- [Quickstart](https://aelshinawy.github.io/gournal/docs/start-here/quickstart/): install, connect Claude Code, log an entry, and read a standup.
- Guides: [Standups and work logs](https://aelshinawy.github.io/gournal/docs/guides/standups-and-work-logs/), [GitHub activity](https://aelshinawy.github.io/gournal/docs/guides/github-activity/), [Logging with AI agents](https://aelshinawy.github.io/gournal/docs/guides/logging-with-ai-agents/), [Claude Code setup](https://aelshinawy.github.io/gournal/docs/guides/claude-code-setup/), [Data safety and backups](https://aelshinawy.github.io/gournal/docs/guides/data-safety-and-backups/).
- CLI reference: every command and option, for example [`gournal add`](https://aelshinawy.github.io/gournal/docs/reference/cli/add/) and [`gournal standup`](https://aelshinawy.github.io/gournal/docs/reference/cli/standup/).
- MCP tools: every tool and field, for example [`add_entry`](https://aelshinawy.github.io/gournal/docs/reference/mcp/add_entry/) and [`get_standup`](https://aelshinawy.github.io/gournal/docs/reference/mcp/get_standup/).
- [Configuration](https://aelshinawy.github.io/gournal/docs/reference/configuration/): every key in `config.json`.

## License

MIT
