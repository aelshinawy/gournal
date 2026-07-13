# 📔 Gournal

**A Developer's Command-Line Journal with Git Integration**

[![CI](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml/badge.svg)](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/gournal)](https://www.npmjs.com/package/gournal)
[![npm downloads](https://img.shields.io/npm/dm/gournal)](https://www.npmjs.com/package/gournal)
[![License: MIT](https://img.shields.io/npm/l/gournal)](https://opensource.org/licenses/MIT)

Gournal is a CLI tool that helps developers:
- Log daily work in context of Git projects
- Generate standup reports automatically

![gournal demo](./demo.gif)

## ✨ Features

- **Git-Aware Logging**: Auto-tag entries with project names
- **Standup Reports**: `gournal standup` generates daily, weekly, or monthly summaries
- **Project Filtering**: Scope standup/export/find output to a single project with `--project`
- **Export**: `gournal export` writes entries to Markdown or CSV
- **MCP Server**: `gournal mcp` exposes your journal to AI agents like Claude Code

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- Git (for project detection)

### Installation
```bash
npm install -g gournal
# or
yarn global add gournal
```

### Usage
```bash
# Log an entry
gournal add "Fixed the flaky auth test" --tags bug,testing

# Daily / weekly / monthly standup
gournal standup
gournal standup --week
gournal standup --month

# Scope any report to one project
gournal standup --week --project gournal

# Export entries
gournal export --format md
gournal export --format csv --project gournal --output entries.csv
```

## 🤖 MCP Server

`gournal mcp` starts an [MCP](https://modelcontextprotocol.io) server (stdio transport) that exposes your journal to AI agents like Claude Code. It reuses the same storage/report/export logic as the CLI, so agents see exactly what you'd see.

Tools exposed:
- `list_entries` — list entries, filterable by `project`, `from`, `to`
- `get_standup` — generate a standup report (`yesterday` / `week` / `month`, filterable by `project`)
- `get_monthly_summary` — generate the monthly standup summary
- `export_entries` — export entries to `md` or `csv`

### Using with Claude Code

Register it as an MCP server, e.g. with the Claude Code CLI:
```bash
claude mcp add gournal -- gournal mcp
```

Or add it directly to your MCP client config (e.g. `.mcp.json`):
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

Once registered, you can ask your agent things like "summarize what I worked on this week" or "export my gournal entries for the api project to markdown."