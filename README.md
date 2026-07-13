# 📔 Gournal

**A Developer's Command-Line Journal with Git Integration**

[![CI](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml/badge.svg)](https://github.com/aelshinawy/gournal/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/gournal)](https://www.npmjs.com/package/gournal)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Gournal is a CLI tool that helps developers:
- Log daily work in context of Git projects
- Generate standup reports automatically

<!--
TODO(Ahmed): Add a terminal recording here (e.g. via asciinema or a GIF from vhs/terminalizer).
It should walk through:
  1. `gournal log` / `gournal add` — logging a journal entry
  2. `gournal standup` — generating a daily/weekly/monthly summary
  3. `gournal export` — exporting entries to Markdown or CSV
-->

## ✨ Features

- **Git-Aware Logging**: Auto-tag entries with project names
- **Standup Reports**: `gournal standup` generates daily, weekly, or monthly summaries
- **Project Filtering**: Scope standup/export/find output to a single project with `--project`
- **Export**: `gournal export` writes entries to Markdown or CSV

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