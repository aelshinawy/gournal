---
title: Install
description: Install gournal with npm, check the install, and optionally sign in to GitHub.
---

## Requirements

- **Node.js 22.13 or newer.** Run `node --version` to check.
- **Git 2.31 or newer.** Gournal uses Git to find the project, the repository, and the branch of a directory.
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

GitHub sync uses the `gh` CLI. Gournal stores no token. `gh` keeps your sign-in.

1. Install `gh` from [cli.github.com](https://cli.github.com).
2. Run `gh auth login`.

Skip this step if you do not want GitHub activity in your standups. Everything else works without `gh`.

## Where gournal keeps data

Gournal keeps its data in `~/.gournal`. Set the `GOURNAL_HOME` environment variable to use a different folder. See [Environment variables](/gournal/docs/reference/environment/).

## Next step

Follow the [Quickstart](/gournal/docs/start-here/quickstart/).
