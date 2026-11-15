---
title: Install
description: Install gournal with npm, check the install, and optionally sign in to GitHub.
---

## Requirements

- **Node.js 22.13 or newer.** Run `node --version` to check.
- **Git 2.31 or newer.** Gournal uses Git to find the project, the repository, and the branch of a directory. With Git older than 2.31, or without Git, gournal puts entries in the `uncategorized` project and records no repository or branch.
- **The GitHub CLI (`gh`), optional.** You need it only for [GitHub sync](/gournal/docs/guides/github-activity/).

## Install gournal

Install the `gournal` package from npm.

```bash
npm install -g gournal
```

## Check the install

Run this command.

```console
$ gournal --version
0.9.0
```

Gournal prints its version number. Your number can be different. If your shell says `command not found`, your global npm folder is not on your `PATH`. Run `npm config get prefix` and add its `bin` folder to your `PATH`.

## Sign in to GitHub (optional)

GitHub sync uses the `gh` CLI. Install `gh` and run `gh auth login`. See [Before you start](/gournal/docs/guides/github-activity/#before-you-start) in the GitHub activity guide.

Skip this step if you do not want GitHub activity in your standups. Everything else works without `gh`.

## Where gournal keeps data

Gournal keeps its data in `~/.gournal`. Set the `GOURNAL_HOME` environment variable to use a different folder. See [Environment variables](/gournal/docs/reference/environment/).

## Upgrade

Run `npm install -g gournal` again to get the newest version. If you upgrade from version 0.6 or older, see [Migrating from 0.x](/gournal/docs/guides/migrating-from-0x/).

## Uninstall

1. Remove the Claude Code setup: `gournal setup claude --uninstall`. See [Claude Code setup](/gournal/docs/guides/claude-code-setup/#undo-it).
2. Remove the package: `npm uninstall -g gournal`.
3. Optional: delete the data folder, `~/.gournal` (or the folder in `GOURNAL_HOME`). This deletes your journal, your settings, and your backups. Export a bundle first if you want a copy. See [Data safety and backups](/gournal/docs/guides/data-safety-and-backups/#bundles).

Steps 1 and 2 keep your journal. Run step 1 before step 2, because `gournal setup claude --uninstall` needs the `gournal` command.

## Next step

Follow the [Quickstart](/gournal/docs/start-here/quickstart/).
