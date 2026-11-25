---
title: Install
description: Install gournal with npm, check the install, and optionally sign in to GitHub.
---

## Requirements

- **Node.js 22.13 or newer.** Run `node --version` to check. If you use a Node.js version manager, see [How Claude Code starts gournal](/docs/guides/claude-code-setup/#how-claude-code-starts-gournal).
- **Git 2.7 or newer.** Gournal uses Git to find the project, the repository, and the branch of a directory. With Git older than 2.7, or without Git, gournal puts entries in the `uncategorized` project and records no repository or branch.
- **The GitHub CLI (`gh`), optional.** You need it only for [GitHub sync](/docs/guides/github-activity/).
- **On Windows, Git for Windows.** Gournal runs `git`, so `git.exe` must be on your `PATH`. The Git for Windows installer does this.

## Supported platforms

Gournal supports macOS, Linux, and Windows. CI runs the test suite on all three. A few tests that check file mode bits skip on Windows. CI also installs the packed package, runs the commands, and runs `gournal setup claude` against a test copy of the `claude` command.

Gournal needs Node.js 22.13 or newer because it uses the `node:sqlite` module. Node.js still marks `node:sqlite` as experimental, so it can change in a later Node.js release. Gournal hides the Node.js warning about this.

Keep your journal on a local disk. Gournal uses SQLite in WAL mode, and WAL mode does not work on network drives. If your gournal home folder is on a network drive, the journal can lock up or become damaged.

### macOS and Linux

Use a current release of macOS or Linux. Install Node.js 22.13 or newer and Git. The default data folder is `~/.gournal`.

### Windows

Gournal supports Windows on x64, as a native program. CI runs on Windows Server 2025 with Node.js 22.13 and 24. Use Node.js 22.13 or newer. Install gournal with `npm install -g gournal`.

1. Install Git for Windows. Gournal runs `git`.
2. The GitHub CLI (`gh`) is optional.
3. Gournal looks for `git.exe` and `gh.exe` in the absolute folders of your `PATH`. It ignores `.cmd` and `.bat` files. It skips the current folder and relative `PATH` entries. Put Git for Windows on your `PATH`. The `gh` CLI is optional.
4. The default data folder is `%USERPROFILE%\.gournal`. Windows ignores the `HOME` variable. Set `GOURNAL_HOME` to use a different folder.
5. `gournal setup claude` registers the MCP server as the full path of `cmd.exe`, then `/d /c`, then the full path of `gournal.cmd`, then `mcp`. If the launcher path has one of the characters `% ^ & | < > ! " ( ) @`, setup prints an error. Set `GOURNAL_HOME` to a folder without these characters and run setup again.
6. `gournal setup claude --hook` writes the Stop hook in exec form, so no shell has to quote the path. If you installed Claude Code with npm (`claude.cmd`), setup runs it through `cmd.exe`. Gournal runs an npm-installed `claude.cmd` only when it finds it in an absolute folder of your `PATH`. It never runs a `claude.cmd` or `claude.bat` from the current folder.

These limits apply on Windows.

- **File permissions.** Gournal cannot set the 0700 and 0600 file modes on Windows. The journal depends on the permissions of your profile folder. These permissions normally block other standard users. Administrators and the system can still read your files. Do not put `GOURNAL_HOME` on a shared folder.
- **Terminal.** In mintty, standard input is not a terminal. Gournal treats it as not interactive. `gournal setup claude` prints its plan and exits with code 1 until you pass `--yes`. Use Windows Terminal, PowerShell, or cmd to get prompts.
- **Search.** The Node.js build on the Windows CI runner has no FTS5. On such a build, `gournal find` matches substrings. See [Search entries](/docs/reference/search/) for how matching differs between Node.js builds. Run `gournal index rebuild` to check. It fails with "This Node build has no FTS5" when the build lacks FTS5.

### WSL

Gournal counts WSL as Linux. Install gournal inside WSL. Run `gournal setup claude` inside WSL too.

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

Gournal prints its version number. Your number can be different. With npm, if your shell says `command not found`, your global npm folder is not on your `PATH`. Run `npm config get prefix` and add its `bin` folder to your `PATH`.

## Sign in to GitHub (optional)

GitHub sync uses the `gh` CLI. Install `gh` and run `gh auth login`. See [Before you start](/docs/guides/github-activity/#before-you-start) in the GitHub activity guide.

Skip this step if you do not want GitHub activity in your standups. Everything else works without `gh`.

## Where gournal keeps data

Gournal keeps its data in `~/.gournal`. On Windows, this is `%USERPROFILE%\.gournal`. Set the `GOURNAL_HOME` environment variable to use a different folder. See [Environment variables](/docs/reference/environment/).

## Upgrade

Run `npm install -g gournal` again to get the newest version. Then run `gournal setup claude` again to update the copy that Claude Code uses when the package is missing. If you install under another Node.js version, any `gournal` command from the new install makes Claude Code use it. See [How Claude Code starts gournal](/docs/guides/claude-code-setup/#how-claude-code-starts-gournal). The import of the 0.x `entries.json` file was removed. To migrate from 0.x, install gournal 0.10 first.

## Uninstall

1. Remove the Claude Code setup: `gournal setup claude --uninstall`. This also removes the launcher and `runtime` in the gournal home (`~/.gournal/bin` and `~/.gournal/runtime` by default). Use the same `GOURNAL_HOME` as the install. See [Claude Code setup](/docs/guides/claude-code-setup/#undo-it).
2. Remove the package: `npm uninstall -g gournal`.
3. Optional: delete the data folder, `~/.gournal` (`%USERPROFILE%\.gournal` on Windows, or the folder in `GOURNAL_HOME`). This deletes your journal, your settings, and your backups. Export a bundle first if you want a copy. See [Data safety and backups](/docs/guides/data-safety-and-backups/#bundles).

Steps 1 and 2 keep your journal. If you remove the package first, see [Claude Code cannot start gournal](/docs/resources/troubleshooting/#claude-code-cannot-start-gournal).

## Next step

Follow the [Quickstart](/docs/start-here/quickstart/).
