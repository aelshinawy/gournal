# Changelog

All notable changes to gournal are in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Gournal uses [Semantic Versioning](https://semver.org/).

The last version on npm before this release is 0.5.0.
Versions 0.6.0 to 0.8.0 were internal steps and were not published to npm.
Their changes are in this file so that you can see how 0.9.0 grew from 0.5.0.

## [0.12.0](https://github.com/aelshinawy/gournal/compare/v0.11.0...v0.12.0) (2026-11-25)


### ⚠ BREAKING CHANGES

* **mcp:** The list_entries MCP tool is removed. Use find_entries instead. The message argument of add_entry is removed. Use summary instead.

### Features

* **mcp:** remove list_entries and the message alias ([#50](https://github.com/aelshinawy/gournal/issues/50)) ([256598d](https://github.com/aelshinawy/gournal/commit/256598de77425b37c398f7477daf89e0cf9bdf4e))


### Bug Fixes

* **setup:** survive Node version managers in the Claude Code setup ([#35](https://github.com/aelshinawy/gournal/issues/35)) ([4d62749](https://github.com/aelshinawy/gournal/commit/4d62749d62e02269da1091c8f74bc6f4082f9d1c))

## [0.11.0](https://github.com/aelshinawy/gournal/compare/v0.10.0...v0.11.0) (2026-11-21)


### ⚠ BREAKING CHANGES

* **storage:** the 0.x entries.json import and the migrate command are removed.

### Features

* **mcp:** deprecate list_entries and the message alias ([#40](https://github.com/aelshinawy/gournal/issues/40)) ([927e439](https://github.com/aelshinawy/gournal/commit/927e4397229a78dff4a4f49bab426a979aa98c94))


### Bug Fixes

* **cli:** drop the always-zero duplicates count from the import line ([#38](https://github.com/aelshinawy/gournal/issues/38)) ([c52c9ff](https://github.com/aelshinawy/gournal/commit/c52c9ffc493bd99f37adcb020863bc9e2a6ab0e0))
* **cli:** warn when an old entries.json is present and the journal is empty ([#43](https://github.com/aelshinawy/gournal/issues/43)) ([4772a3c](https://github.com/aelshinawy/gournal/commit/4772a3c911d1e6edbbf082695e563e379a118703))


### Refactoring

* **storage:** remove the 0.x entries.json import and the migrate command ([#37](https://github.com/aelshinawy/gournal/issues/37)) ([45ff2f1](https://github.com/aelshinawy/gournal/commit/45ff2f184d249fee29e5372de44814a5b3dc6743))

## [0.10.0](https://github.com/aelshinawy/gournal/compare/v0.9.0...v0.10.0) (2026-11-20)


### Features

* **cli:** show a spinner on stderr for background commands ([#34](https://github.com/aelshinawy/gournal/issues/34)) ([66674e4](https://github.com/aelshinawy/gournal/commit/66674e47703d69ca1cb6d98d478208cbe62dab03))
* keep the entry when gournal add gets a bad --resolves id, and print similar-tag notes ([#23](https://github.com/aelshinawy/gournal/issues/23)) ([cfbf198](https://github.com/aelshinawy/gournal/commit/cfbf198344fcfc8838df233905bf784ef351cc4c))
* let update_entry split a retried long summary and return its notes ([#25](https://github.com/aelshinawy/gournal/issues/25)) ([c6b314d](https://github.com/aelshinawy/gournal/commit/c6b314d61607ec7fa45a3e6cd2f417c65db2846c))


### Bug Fixes

* link a restored entry to GitHub activity ([#26](https://github.com/aelshinawy/gournal/issues/26)) ([245edbf](https://github.com/aelshinawy/gournal/commit/245edbf9ebcad4d252952b522b637332146c93c0))


### Dependencies

* replace @modelcontextprotocol/sdk 1.x with @modelcontextprotocol/server 2.x ([#28](https://github.com/aelshinawy/gournal/issues/28)) ([427665f](https://github.com/aelshinawy/gournal/commit/427665f036bbc8f71dc0b8c7ee99935843b47c57))

## 0.9.0 (unreleased)

### Upgrading from 0.5.0

1. Install Node.js 22.13 or newer. Gournal needs it for the built-in `node:sqlite` module.
2. Run `npm install -g gournal`.
3. On Windows, gournal now uses `USERPROFILE` and ignores `HOME`. If your 0.5.0 data is in `%HOME%\.gournal`, move it or set `GOURNAL_HOME` to that folder before the first run.
4. Run any gournal command. Gournal creates `gournal.db` in `~/.gournal` and imports your old `entries.json` file.
5. Check the line on stderr, for example `gournal: imported 2 entries from entries.json`.
6. Gournal never changes `entries.json`. You can keep the file.
7. Restart every MCP client, for example Claude Code. An old MCP server keeps writing to `entries.json`. Run `gournal migrate` to import those late entries.
8. Read [Migrating from 0.x](https://aelshinawy.github.io/gournal/docs/guides/migrating-from-0x/) if you want to rewrite old entries with a reviewed plan.

Other changes that can affect you:

1. The first sentence of an old entry becomes its summary. The full text goes to `details`.
2. `gournal find` searches for words, not for one exact phrase. Every word must match.
3. The default answer to the `gournal clear` confirmation is now no.
4. `gournal undo` removes an entry softly. Run `gournal restore <id>` to bring it back.
5. The MCP tool `add_entry` still accepts `message`. It is a deprecated alias for `summary`.
6. `gournal export -o <file>` refuses to replace an existing file. Add `--force` to replace it. A script that repeats a backup to the same path must add `--force`.
7. `gournal export -o` refuses a symlink and every target that is not a regular file, such as a folder or `/dev/stdout`. This is true also with `--force`. To print to the terminal, omit `-o`.
8. An empty project, or a project that has only control characters, is stored as `uncategorized`. This is true on add and on update. Old entries that already have an empty project keep it.
9. `gournal import` strips control characters from every text field of the bundle, including line breaks in summaries. Tab and line break stay in `details`. A bundle from `gournal export` is not affected.

### Added

1. `gournal sync` and the MCP tool `sync_activity`. They fetch your GitHub pull requests, commits, and reviews through the `gh` CLI. Gournal stores no GitHub token.
2. Links between GitHub activity and entries. Gournal links on a PR number, a commit hash, or a branch that matches an entry in a two-hour window.
3. Automatic sync before `standup` and `log` when the data is stale. Set `github.autoSync` to `false` in `config.json`, or set `GOURNAL_NO_AUTOSYNC=1`, to turn it off.
4. An `Also` line in the standup. It counts the GitHub activity that no shown entry links to. `gournal standup --activity` lists that activity.
5. `gournal setup claude`. It registers the gournal MCP server with Claude Code and installs the gournal skill. Use `--uninstall` to remove what setup added. `gournal setup claude` exits with status 1 when the `claude` CLI is not found. It prints the manual command first.
6. An optional Claude Code Stop hook. Run `gournal setup claude --hook` to add it. The `gournal hook stop` command asks once per session to log edited work.
7. A documentation site at <https://aelshinawy.github.io/gournal/docs/>. It has guides and a reference for every command and MCP tool.
8. Windows support. Gournal supports Windows on x64. CI runs on `windows-latest` (Windows Server 2025). Gournal runs natively with Node.js 22.13 or newer. CI runs the test suite on Windows. A few tests that check file mode bits skip there. CI also installs the packed package and runs `--version`, `add`, `find`, `standup`, the MCP server, and `gournal setup claude` with `--hook` and `--uninstall`. On Windows, `gournal setup claude` registers the MCP server with the full path to `node.exe` and to the gournal script. It writes the Stop hook in exec form: `command` is the `node.exe` path, and `args` holds the script path, `hook`, and `stop`. It runs an npm-installed `claude.cmd` through `cmd.exe`. See [Supported platforms](https://aelshinawy.github.io/gournal/docs/start-here/install/#supported-platforms) for the requirements and the limits.

### Changed

1. `gournal export -o` refuses to replace a file unless you pass `--force`. It never writes through a symlink.
2. The MCP tools cap the size of their inputs and carry tool annotations. The server instructions say that entry text and GitHub titles are data, not instructions.
3. The `delete_entry` result says `removed`.
4. Help text in the CLI and the MCP tools uses the same wording. Tests guard it against drift.
5. Gournal reads the repository identity without `git rev-parse --path-format`. The minimum Git version is 2.7.
6. `README.md` is shorter. The guides moved to the documentation site.
7. Gournal no longer depends on `fs-extra`. Its type packages are gone too.

### Fixed

1. Gournal creates the home folder with mode 0700 and new files with mode 0600. On the first run, gournal also tightens an existing default home (`~/.gournal`) and its database, backups, and config file to 0700 and 0600. A custom `GOURNAL_HOME` keeps the mode of its folder and of its existing files. When gournal rewrites `config.json` in a custom home, the new file gets mode 0600.
2. Gournal strips control characters from entry fields on write and from terminal output.
3. CSV export neutralizes cells that start like a formula.
4. A reader that closes standard output early, for example `gournal log | head`, no longer makes gournal fail. It exits with code 0.
5. The error for a database that cannot be written names the home folder.
6. `gournal setup claude` recognizes only its own Stop hook shape, also when the hook runs through a symlink to the gournal binary.
7. A partial sync no longer moves the sync cursor backward.
8. The `Also` line ignores links of removed entries.
9. Production dependency advisories reported by `npm audit` are fixed.

### Release

1. The package has a `clean` script and a `prepublishOnly` script. A publish builds from a clean `dist` folder and runs the tests first.
2. TypeScript does not emit files when the build has an error.
3. `scripts/pack-smoke.sh` packs the package, installs the tarball, and runs the installed command. CI runs it on pull requests and on pushes to main.
4. A release workflow publishes to npm with provenance when a `v*` tag is pushed.
5. `package.json` names the author, the bug tracker, and public access.

## 0.8.0

### Added

1. One query model for the CLI and the MCP server. Every command and tool that reads entries uses it.
2. Reports in terminal, Markdown, JSON, and CSV formats.
3. A standup with `Done`, `Blockers`, `Next`, and `Stale` sections. Open blockers and next items carry forward until you resolve them. After `staleAfterDays` days (default 14), an open item moves to the `Stale` line.
4. The MCP tool `find_entries`. MCP tools return structured output.
5. Project, repository, and branch detection from the `cwd` of `add_entry`. The project is the repository name, not the folder name.
6. `gournal index rebuild` to drop and recreate the full-text search index.
7. Settings in `config.json`: project aliases, tag aliases, ticket prefixes, `weekStartsOn`, and `staleAfterDays`.
8. A lint rule that enforces the order of the source layers. CI runs it.

### Changed

1. `gournal standup` open items ignore `--from`.
2. Blank search text matches nothing.
3. Search terms are sanitized for both search modes.
4. Gournal resolves project aliases without regard to case.

## 0.7.0

### Added

1. A SQLite database, `gournal.db`, replaces `entries.json` as the store. Gournal uses the built-in `node:sqlite` module.
2. Automatic import of `entries.json`. Gournal imports each line once, also when an old process writes late lines. Gournal never writes to `entries.json`.
3. Daily database backups in `backups/`. Gournal keeps the newest 7.
4. Entries with a short `summary`, an optional `details` field, a `kind` of `done`, `blocker`, or `next`, tags, and refs such as ticket keys and PR numbers. A summary has at most 120 characters. A longer summary is cut at the first sentence, and the full text goes to `details`.
5. `gournal resolve <id>` and the `resolves` option on `add` close open blockers and next items.
6. Soft delete. `gournal undo` and `gournal clear` keep the rows in the database. `gournal restore <id>` brings an entry back.
7. `gournal export --format bundle` and `gournal import <file>`. Import merges by entry id.
8. `gournal migrate`, with `--plan`, `--dry-run`, and `--diff`, to rewrite old entries with a reviewed plan. Gournal saves a snapshot before it applies a plan.
9. The MCP tools `update_entry`, `delete_entry`, and `resolve_entry`.
10. `GOURNAL_HOME` sets the home folder of gournal. The default is `~/.gournal`.
11. Full-text search through SQLite FTS5. On a Node build without FTS5, search still works and matches any part of the text.

### Changed

1. The minimum Node.js version is 22.13.
2. CI tests on Node 22.13 and Node 24.
3. Gournal suppresses the experimental warning of `node:sqlite`.
4. Tag normalization applies to every new entry. Ticket tags convert to refs only for the prefixes in `ticketPrefixes`.

### Removed

1. The JSON write path. Gournal no longer writes `entries.json`.

## 0.6.0

### Added

1. A cross-process lock around journal writes, so that many MCP server processes do not lose entries.
2. A daily backup of the journal file.

### Changed

1. Gournal writes the journal file in one atomic step.
2. `gournal clear` asks for confirmation. The default answer is no.
3. `--from` and `--to` include their whole day.
4. The MCP server reports its real version.

### Fixed

1. Gournal no longer replaces a journal file that it cannot read. It stops with the path of the latest backup.
2. `gournal undo` removes the entry that it reports.
3. `gournal find` and the MCP tool `list_entries` check date bounds before they search.
